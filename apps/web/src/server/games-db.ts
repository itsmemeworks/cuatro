/**
 * Games surface's DB accessor — now a thin re-export of the shared
 * connection in ./db.ts (see that file's header for why matches-db.ts and
 * this module were consolidated onto one connection). Kept as its own
 * module/name so games-service.ts, standing-games-service.ts, and every
 * games/* route and page can keep importing `getGamesClient` from here
 * unchanged.
 *
 * Concurrency-critical mutations (RSVP dropout -> auto-promotion) run
 * inside `await db.transaction(async (tx) => ...)` against this shared
 * Postgres connection. Postgres MVCC does NOT serialise writers the way
 * better-sqlite3 did, so those transactions take an explicit
 * `SELECT ... FOR UPDATE` row lock on the anchoring row (the session, or the
 * standing_games parent) before their read-decide-write — see
 * games-service.ts. That lock, not the driver, is what now prevents two
 * concurrent RSVP mutations from double-promoting the same reserve.
 */
export { getDb as getGamesClient, __resetDbForTests as __resetGamesClientForTests } from "./db";
