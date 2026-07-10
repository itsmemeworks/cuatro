import { bigint, boolean, text } from 'drizzle-orm/pg-core'

// Every table id is a random UUID string, generated client-side at insert time.
// Kept as `text` (not Postgres `uuid`) so the app-facing id type stays `string`
// and existing ids/fixtures need no reformatting.
export const idColumn = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

// World-ready rule: all timestamps are stored as UTC epoch MILLISECONDS.
// On SQLite these were `integer(..., { mode: 'timestamp_ms' })` (app-facing
// `Date`). On Postgres they are `bigint(..., { mode: 'number' })`: the value
// is the same epoch-ms integer, but the app-facing type is now `number`, not
// `Date`. Every read that did `.getTime()` becomes a no-op; every write that
// passed a `Date` now passes `Date.now()`/`d.getTime()`. (mode 'number' is
// safe here: epoch-ms stays well under Number.MAX_SAFE_INTEGER until year
// ~287396, and postgres-js returns bigint columns as JS numbers under it.)
export const timestampColumn = (name: string) => bigint(name, { mode: 'number' })

export const createdAtColumn = (name = 'created_at') =>
  timestampColumn(name)
    .notNull()
    .$defaultFn(() => Date.now())

// Real Postgres boolean now (was SQLite integer 0/1 via mode: 'boolean').
export const booleanColumn = (name: string) => boolean(name)

// FRIENDLIES (V1-READINESS #10): every game is either Competitive or Friendly.
// A Friendly match records scores, seals, and counts for Reliability / streaks /
// played-with, but its result NEVER moves Glass (no rating_events, no
// rating/confidence change). The classification flows down an inheritance chain:
//   circles.default_game_type            (the circle's default)
//     -> standing_games.game_type        (set from the circle default at creation, organiser can override)
//     -> sessions.game_type              (a standing session inherits its standing game's type at materialisation; a one-off inherits the circle default; either can be overridden)
//       -> matches.game_type             (SNAPSHOT at record time from the session — so the Ledger can say WHY no rating moved)
// The rating gate reads matches.game_type at the single point rating events are
// written (see apps/web/src/server/matches-db.ts applyGlassAndPersist).
export const GAME_TYPES = ['competitive', 'friendly'] as const
export type GameType = (typeof GAME_TYPES)[number]

// Enum-typed text (gives the TS union) NOT NULL default 'competitive'. The
// value set is additionally pinned by a DB CHECK constraint declared on each
// owning table (drizzle's `enum:` only shapes the TS type, it does not emit a
// constraint) — see circles/standing-games/sessions/matches schema files.
export const gameTypeColumn = (name: string) =>
  text(name, { enum: GAME_TYPES }).notNull().default('competitive')
