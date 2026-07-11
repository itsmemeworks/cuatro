/**
 * Web-push delivery. VAPID keys come from env and are unset in dev, which is
 * fine — sendPushToUser() just no-ops until they're configured.
 *
 * Subscriptions persist in Postgres (`push_subscriptions`), keyed on endpoint,
 * so they survive a deploy (the old in-memory Map did not). One user can have
 * many devices; sendPushToUser fans out to all of them and prunes any endpoint
 * the push service reports as expired (404/410).
 */
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { pushSubscriptions } from "@cuatro/db";
import { getDb } from "@/server/db";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:hello@cuatro.app";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }
  configured = true;
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export interface StoredPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Delivery seam: the real transport is webpush.sendNotification. Tests install
// a fake to assert fan-out and simulate expiry without a network. A transport
// signalling an expired endpoint throws an error carrying `statusCode` 404 or
// 410 (web-push's WebPushError shape), which prunes that subscription row.
type PushTransport = (
  subscription: webpush.PushSubscription,
  payload: string,
) => Promise<unknown>;
const realTransport: PushTransport = (subscription, payload) =>
  webpush.sendNotification(subscription, payload);
let transport: PushTransport = realTransport;

/** Test-only: swap the delivery transport (pass null to restore the real one). */
export function __setPushTransportForTests(t: PushTransport | null): void {
  transport = t ?? realTransport;
}

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

/**
 * Persist a subscription for a user. Upserts on endpoint: a browser
 * re-subscribing (or a second device landing on the same endpoint) refreshes
 * the keys and re-homes the row to the current user rather than duplicating.
 */
export async function saveSubscription(userId: string, sub: StoredPushSubscription): Promise<void> {
  const { db } = await getDb();
  const now = Date.now();
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: sub.endpoint,
      keysP256dh: sub.keys.p256dh,
      keysAuth: sub.keys.auth,
      lastUsedAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, keysP256dh: sub.keys.p256dh, keysAuth: sub.keys.auth, lastUsedAt: now },
    });
}

/** Remove a subscription by its endpoint (unsubscribe / expiry). */
export async function removeSubscription(endpoint: string): Promise<void> {
  const { db } = await getDb();
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

function isExpired(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body?: string; url?: string },
): Promise<{ sent: boolean; reason?: string }> {
  const ready = ensureConfigured();
  if (!ready) return { sent: false, reason: "VAPID keys not configured" };

  const { db } = await getDb();
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  if (subs.length === 0) return { sent: false, reason: "no subscription for user" };

  const body = JSON.stringify(payload);
  const now = Date.now();
  let delivered = 0;

  await Promise.all(
    subs.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.keysP256dh, auth: row.keysAuth },
      } as webpush.PushSubscription;
      try {
        await transport(subscription, body);
        delivered += 1;
        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: now })
          .where(eq(pushSubscriptions.endpoint, row.endpoint));
      } catch (err) {
        // An expired endpoint (404/410) is pruned; any other failure is
        // transient and left in place for the next send to retry.
        if (isExpired(err)) {
          await db
            .delete(pushSubscriptions)
            .where(
              and(eq(pushSubscriptions.endpoint, row.endpoint), eq(pushSubscriptions.userId, userId)),
            );
        }
      }
    }),
  );

  if (delivered === 0) return { sent: false, reason: "all sends failed" };
  return { sent: true };
}
