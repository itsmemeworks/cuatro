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
