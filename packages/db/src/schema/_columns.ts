import { integer, text } from 'drizzle-orm/sqlite-core'

// Every table id is a random UUID string, generated client-side at insert time.
export const idColumn = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

// World-ready rule: all timestamps are stored as UTC epoch milliseconds.
// drizzle's `timestamp_ms` mode converts JS Date <-> integer automatically.
export const timestampColumn = (name: string) => integer(name, { mode: 'timestamp_ms' })

export const createdAtColumn = (name = 'created_at') =>
  timestampColumn(name)
    .notNull()
    .$defaultFn(() => new Date())

export const booleanColumn = (name: string) => integer(name, { mode: 'boolean' })
