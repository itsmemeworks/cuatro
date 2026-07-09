/**
 * The curated Circle header collection (Circle v2). Every Circle shows a
 * header photo; by default one is auto-assigned deterministically from this
 * bundled set, and an organiser can later pick a specific one.
 *
 * The images are SELF-HOSTED in apps/web/public/circle-headers (offline PWA +
 * a strict CSP forbid hotlinking a remote URL). The database stores only a
 * KEY (e.g. "court-03"), never a URL — the key resolves to a same-origin path
 * here. Attribution + licence for every photo lives beside the files in
 * public/circle-headers/ATTRIBUTIONS.md (Unsplash License).
 *
 * Resolution pattern (both server read models and the UI use this): a Circle's
 * effective header is `circle.headerImage ?? headerFor(circle.id)` — an
 * explicit choice wins, otherwise the deterministic auto-assignment gives
 * every existing Circle a stable header with no backfill. Then `headerUrl(key)`
 * turns that key into the <img> src.
 *
 * Zero dependencies and pure, so it is safe to import from both server code
 * (server/circles.ts validation) and client components.
 */

/**
 * The curated header keys. Ordered; the order is load-bearing for
 * `headerFor`'s deterministic assignment, so only ever APPEND new keys —
 * never reorder or delete, or existing Circles' auto-assigned headers shift.
 */
export const HEADER_KEYS = [
  "court-01",
  "court-02",
  "court-03",
  "court-04",
  "court-05",
  "court-06",
  "court-07",
  "court-08",
  "court-09",
  "court-10",
  "court-11",
  "court-12",
] as const;

export type HeaderKey = (typeof HEADER_KEYS)[number];

/** True if `key` is one of the curated collection keys. */
export function isHeaderKey(key: string | null | undefined): key is HeaderKey {
  return key != null && (HEADER_KEYS as readonly string[]).includes(key);
}

/**
 * FNV-1a (32-bit), a small, fast, well-distributed non-cryptographic string
 * hash. Deterministic and dependency-free, so the same circle id maps to the
 * same header everywhere (server render, client render, tests) with no stored
 * state. Not used for anything security-sensitive.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept in 32-bit unsigned range via Math.imul + >>> 0.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * The deterministic default header for a Circle: a stable curated key derived
 * from the Circle id. Every Circle (including ones created before Circle v2)
 * gets a consistent header with no backfill and no stored value. Callers that
 * want the *effective* header should prefer an explicit `headerImage` when set:
 * `circle.headerImage ?? headerFor(circle.id)`.
 */
export function headerFor(circleId: string): HeaderKey {
  return HEADER_KEYS[fnv1a(circleId) % HEADER_KEYS.length];
}

/** The same-origin path to a curated header image. */
export function headerUrl(key: HeaderKey): string {
  return `/circle-headers/${key}.jpg`;
}

/**
 * The effective header URL for a Circle: its explicit choice if it is a valid
 * curated key, otherwise the deterministic auto-assignment. Handy one-call
 * resolver for read models and cards.
 */
export function resolveHeaderUrl(circleId: string, headerImage: string | null | undefined): string {
  return headerUrl(isHeaderKey(headerImage) ? headerImage : headerFor(circleId));
}
