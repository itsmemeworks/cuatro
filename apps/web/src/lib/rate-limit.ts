import { NextResponse } from "next/server";
import { errorCopy } from "@/lib/error-copy";

/**
 * In-process sliding-window rate limiter.
 *
 * PER-MACHINE BY DESIGN. State lives in this module's memory, so limits are
 * counted per Node process, not per cluster. CUATRO runs a single always-warm
 * Fly machine per environment (see CLAUDE.md "Deploy" + the in-process
 * scheduler), so one process IS the whole app and an in-memory limiter is the
 * honest, dependency-free choice at this scale. If we ever run more than one
 * machine (HA / horizontal scale), this MUST move to a shared store (Redis,
 * Postgres, Supabase) or each replica will grant the full budget independently.
 * There is no other reason to touch this file when scaling; grep for
 * "PER-MACHINE" before adding machines.
 */

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds until the caller may retry. 0 when allowed. */
  retryAfterSeconds: number;
};

export type RateLimitOptions = {
  /** Max requests permitted within the window. */
  max: number;
  /** Sliding window length in milliseconds. */
  windowMs: number;
};

// Memory bound: a scanner rotating keys (IPs, tokens) must never balloon the
// process. We cap the number of live buckets and evict the least-recently-used
// once the cap is hit — Map preserves insertion order, and we re-insert a key
// on every touch, so the first entries are always the stalest.
const MAX_KEYS = 10_000;

// Each key maps to the ascending-sorted timestamps (ms) of its recent hits.
const buckets = new Map<string, number[]>();

/**
 * Record a hit against `key` and decide whether it is allowed under a sliding
 * window. Pure of any request/response concern so tests can drive it directly.
 * Always enforces — the vitest bypass lives in {@link enforceRateLimit}, not
 * here, so unit tests can assert real windowing behaviour.
 */
export function limit(key: string, { max, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Prune this key's expired hits on touch (amortised cleanup — no global sweep).
  const existing = buckets.get(key);
  const hits = existing ? existing.filter((t) => t > cutoff) : [];

  if (hits.length >= max) {
    // Denied: the window frees up when the oldest surviving hit ages out.
    const oldest = hits[0];
    const retryAfterMs = oldest + windowMs - now;
    // Refresh recency + keep the pruned list so memory stays bounded.
    buckets.delete(key);
    buckets.set(key, hits);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  hits.push(now);
  // Move-to-end so this key counts as most-recently-used for LRU eviction.
  buckets.delete(key);
  buckets.set(key, hits);

  // Evict least-recently-used keys if we're over the cap. A single hit can only
  // add one key, so one eviction per call keeps us at or below MAX_KEYS.
  while (buckets.size > MAX_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * True only when running under vitest AND explicitly disabled via env. Gated on
 * VITEST so the disable switch can never silently turn limiting off in a real
 * deploy — the worst a stray env var can do in prod is nothing.
 */
function disabledForTests(): boolean {
  return Boolean(process.env.VITEST) && process.env.RATE_LIMIT_DISABLED === "1";
}

/**
 * Client IP the Fly way: Fly sets `fly-client-ip` to the real remote address.
 * Fall back to the first hop of `x-forwarded-for` (left-most = original
 * client), then to a constant so a missing header can't split one abuser into
 * unlimited distinct keys.
 */
export function clientIp(request: Request): string {
  const flyIp = request.headers.get("fly-client-ip");
  if (flyIp) return flyIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

/**
 * The 429 body every wrapped endpoint returns. Raw code goes through the shared
 * errorCopy pattern (CLAUDE.md #9) so the UI shows the warm line, never the code.
 */
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { ok: false, error: "rate_limited", message: errorCopy("rate_limited") },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/**
 * Enforce one or more limits for a route. Returns a ready-to-return 429
 * NextResponse when any limit is exceeded (with the tightest Retry-After), or
 * null when the caller may proceed. Bypassed only under the vitest env gate.
 */
export function enforceRateLimit(
  checks: Array<{ key: string } & RateLimitOptions>,
): NextResponse | null {
  if (disabledForTests()) return null;

  let worstRetry = 0;
  for (const { key, max, windowMs } of checks) {
    const result = limit(key, { max, windowMs });
    if (!result.allowed) worstRetry = Math.max(worstRetry, result.retryAfterSeconds);
  }
  if (worstRetry > 0) return rateLimitedResponse(worstRetry);
  return null;
}

/** Test-only: drop all buckets so a suite starts from a clean window. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
