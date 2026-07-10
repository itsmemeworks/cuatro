/**
 * The one shared DB connection for every server-side store in this app
 * (games/standing-games, matches/Glass). Previously games-db.ts and
 * matches-db.ts each memoized their own `createClient()` call, which meant
 * two separate better-sqlite3 connections open against the same SQLite
 * file from the same process — harmless under WAL (SQLite's own locking
 * still serializes writers), but it undercut games-service.ts's stated
 * safety argument for RSVP auto-promotion, which explicitly reasons about
 * "the single shared connection from games-db.ts" to rule out
 * interleaved transactions. One connection removes that gap and matches
 * what the comment already assumed.
 *
 * `createClient(dbPath)` itself (in @cuatro/db) still takes an optional
 * path and remains the right thing for tests that want an isolated
 * `:memory:` database — this singleton is only for the app's own
 * lazily-created, process-wide connection at `DATABASE_PATH`.
 */
import { createClient } from "@cuatro/db";
import type { CuatroClient } from "@cuatro/db";

let clientPromise: Promise<CuatroClient> | null = null;

export function getDb(): Promise<CuatroClient> {
  if (!clientPromise) clientPromise = createClient();
  return clientPromise;
}

/** Test-only: force a fresh connection on next getDb() call. */
export function __resetDbForTests() {
  clientPromise = null;
}
