/**
 * Own DB connection for the games surface (Standing Games / Sessions /
 * RSVPs / notifications), mirroring lib/auth-store.ts's pattern: one
 * memoized connection per Node process, opened lazily against
 * DATABASE_PATH (falling back to ./dev.db) so it points at the same SQLite
 * file every other store in this app uses.
 *
 * This is a genuine `apps/web/src/server/db.ts`-shaped accessor kept under
 * a games-specific filename per the integration note: if a shared
 * `server/db.ts` lands from a sibling wave, games-service.ts/
 * standing-games-service.ts can be repointed at it — they only depend on
 * `CuatroDb`, not on how the connection was obtained.
 *
 * Concurrency-critical mutations (RSVP dropout -> auto-promotion) run
 * inside `db.transaction(...)` against THIS shared connection. better-
 * sqlite3 transactions execute fully synchronously (no `await` inside), so
 * as long as every write path in this module gets its `CuatroDb` from here
 * rather than opening a fresh connection per call, two "concurrent" RSVP
 * mutations within this process can never interleave mid-transaction —
 * one fully commits before the next transaction's callback runs.
 */
import { createClient } from "@cuatro/db";
import type { CuatroClient } from "@cuatro/db";

let clientPromise: Promise<CuatroClient> | null = null;

export function getGamesClient(): Promise<CuatroClient> {
  if (!clientPromise) clientPromise = Promise.resolve(createClient());
  return clientPromise;
}

/** Test-only: force a fresh connection on next getGamesClient() call. */
export function __resetGamesClientForTests() {
  clientPromise = null;
}
