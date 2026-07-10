/**
 * Server-side product analytics — the §9 pilot-metrics instrumentation
 * (../../../../pilot/METRICS.md). This is a thin posthog-node wrapper with the
 * same "fire AFTER the transaction commits, never inside it" contract as
 * lib/realtime/broadcast.ts: an event captured inside a transaction lies when
 * the transaction rolls back, so every call site fires from the same
 * post-commit spot the realtime emit fires from.
 *
 * Privacy-first, by construction:
 *   - Server-side ONLY. No browser SDK, no autocapture, no cookies, no device
 *     ids. We track product events (a match sealed, a Fourth Call filled), not
 *     people browsing.
 *   - `distinct_id` is the acting user id — a real `users` row, guest or not
 *     (guests are first-class, flagged with `is_guest`). System-generated
 *     events (e.g. a session materialised by the scheduler heartbeat, with no
 *     acting user) carry `SYSTEM_DISTINCT_ID` so they never pollute a person.
 *   - `disableGeoip` is on: PostHog must not turn the server's IP into a
 *     person's location.
 *
 * Delivery is fire-and-forget, exactly like the realtime emitter: a capture
 * failure (PostHog unreachable, env misconfigured) must never fail — or even
 * delay — the mutation that triggered it. `captureEvent` never throws.
 *
 * No env ⇒ no-op. POSTHOG_KEY is what turns analytics on; unset (local dev,
 * tests, any env without it) means `getClient()` returns null and every
 * capture is silently dropped. This is why the suite needs no PostHog config.
 */
import { PostHog, type EventMessage } from "posthog-node";

/** distinct_id for events with no acting user (scheduler-materialised sessions, etc.). */
export const SYSTEM_DISTINCT_ID = "cuatro-system";

/** The §9 event names (snake_case, past tense). Kept as a union so a typo is a tsc error, not a silent miss. */
export type AnalyticsEvent =
  | "circle_created"
  | "standing_game_created"
  | "session_materialized"
  | "rsvp_changed"
  | "match_recorded"
  | "match_confirmed"
  | "match_sealed"
  | "match_disputed"
  | "fourth_call_fired"
  | "fourth_call_answered"
  | "fourth_call_resolved";

export interface CaptureInput {
  /** The acting user id. Omit for system-generated events (defaults to SYSTEM_DISTINCT_ID). */
  distinctId?: string;
  /**
   * The Circle this event belongs to. Non-negotiable per METRICS.md: every
   * event slices by circle. Sets both the `circle_id` property and the PostHog
   * `circle` group, so circle-level metrics (1 and 4) are a clean group query.
   */
  circleId: string;
  /** The session, for session-scoped events. Sets `session_id`. */
  sessionId?: string;
  /** Explicit event time in UTC epoch-ms (matches the app's timestamp convention). Defaults to now, but pass the row's own timestamp so backfill/replay don't skew fill-time math. */
  timestamp?: number;
  /** The event-specific properties (already snake_cased to match METRICS.md). */
  properties?: Record<string, unknown>;
}

/**
 * The slice of posthog-node this module uses. A test injects a fake with
 * `__setAnalyticsClientForTests` to assert "this mutation captured this event
 * with these properties" without a live network call.
 */
export interface AnalyticsClient {
  capture(message: EventMessage): void;
  shutdown(): Promise<void>;
}

let overrideClient: AnalyticsClient | null | undefined;
let realClient: AnalyticsClient | null | undefined;

function buildRealClient(): AnalyticsClient | null {
  const key = process.env.POSTHOG_KEY;
  if (!key) return null; // No key ⇒ analytics off (local dev, tests, unconfigured envs).
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  const client = new PostHog(key, {
    host,
    // Serverless-ish: flush each event promptly so a machine recycle can't
    // strand a queued batch. Volume is a pilot's worth, so per-event flushing
    // is cheap; the modest interval is the backstop for anything still queued.
    flushAt: 1,
    flushInterval: 10_000,
    // Product events, not people: never geo-resolve the server IP into a person.
    disableGeoip: true,
  });
  return client;
}

function getClient(): AnalyticsClient | null {
  if (overrideClient !== undefined) return overrideClient;
  if (realClient === undefined) realClient = buildRealClient();
  return realClient;
}

/**
 * Test-only: swap the analytics client. Pass a fake to assert on captures;
 * pass `null` to force the no-op path regardless of env; pass `undefined` to
 * restore the real (env-derived) client.
 */
export function __setAnalyticsClientForTests(client: AnalyticsClient | null | undefined): void {
  overrideClient = client;
}

/**
 * Fire-and-forget capture of a §9 event. Call AFTER the transaction commits.
 * Never throws — a capture failure must not touch the mutation that triggered
 * it (a stale metric is strictly better than a failed RSVP).
 */
export function captureEvent(event: AnalyticsEvent, input: CaptureInput): void {
  const client = getClient();
  if (!client) return;
  try {
    client.capture({
      distinctId: input.distinctId ?? SYSTEM_DISTINCT_ID,
      event,
      properties: {
        circle_id: input.circleId,
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        ...input.properties,
      },
      groups: { circle: input.circleId },
      timestamp: new Date(input.timestamp ?? Date.now()),
      disableGeoip: true,
    });
  } catch (err) {
    console.warn(`[analytics] capture failed: ${event}`, err);
  }
}

/**
 * Flush and close the analytics client — hooked into process exit so a
 * shutdown doesn't drop queued events. Safe to call when analytics is off.
 */
export async function shutdownAnalytics(): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    await client.shutdown();
  } catch (err) {
    console.warn("[analytics] shutdown failed", err);
  }
}

// Best-effort flush on process teardown. `beforeExit` fires on a clean drain;
// SIGTERM is how Fly stops a machine. Guarded so we only register once and
// never in a context without process events.
let exitHooked = false;
if (typeof process !== "undefined" && typeof process.on === "function" && !exitHooked) {
  exitHooked = true;
  const flush = () => {
    void shutdownAnalytics();
  };
  process.once("beforeExit", flush);
  process.once("SIGTERM", flush);
}
