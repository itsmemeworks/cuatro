/**
 * Web-push scaffolding. VAPID keys come from env and are unset in dev,
 * which is fine — sendPushToUser() just no-ops until they're configured.
 * Subscription storage is an in-memory placeholder (TEMPORARY): swap for a
 * push_subscriptions table once one exists.
 */
import webpush from "web-push";

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

// TEMPORARY in-memory store, per server process — fine for dev, not for prod.
const subscriptionsByUser = new Map<string, StoredPushSubscription>();

export function getVapidPublicKey(): string {
  return VAPID_PUBLIC_KEY;
}

export function isPushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

export function saveSubscription(userId: string, sub: StoredPushSubscription): void {
  subscriptionsByUser.set(userId, sub);
}

export function removeSubscription(userId: string): void {
  subscriptionsByUser.delete(userId);
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body?: string; url?: string }
): Promise<{ sent: boolean; reason?: string }> {
  const ready = ensureConfigured();
  const sub = subscriptionsByUser.get(userId);
  if (!ready) return { sent: false, reason: "VAPID keys not configured" };
  if (!sub) return { sent: false, reason: "no subscription for user" };

  await webpush.sendNotification(sub as unknown as webpush.PushSubscription, JSON.stringify(payload));
  return { sent: true };
}
