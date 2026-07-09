import { sql } from 'drizzle-orm'
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { users } from './users.js'

// A "knock": a player asking their way into something they discovered — a
// Circle (The Board / Open Door) or a specific session (Open Door games).
// It is deliberately NOT a foreign-key to either table: `targetId` is
// interpreted against `kind`, keeping one knock inbox regardless of what was
// knocked on. The organiser side (accept/decline) lives in the feature
// wave; this table is the shared substrate.
//
// A player may only have ONE open (status 'pending') knock per target — a
// partial unique index enforces it, so a re-knock after a decline/withdraw
// is allowed but a double-knock while one is still pending is rejected at
// the DB. `decidedAt`/`decidedBy` are set the moment status leaves 'pending'.
export const knocks = sqliteTable(
  'knocks',
  {
    id: idColumn(),
    kind: text('kind', { enum: ['circle', 'session'] }).notNull(),
    targetId: text('target_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    message: text('message'),
    status: text('status', { enum: ['pending', 'accepted', 'declined', 'withdrawn'] })
      .notNull()
      .default('pending'),
    createdAt: createdAtColumn(),
    decidedAt: timestampColumn('decided_at'),
    decidedBy: text('decided_by').references(() => users.id),
  },
  (table) => ({
    // One OPEN knock per (kind, target, user). Partial index so resolved
    // knocks (declined/withdrawn/accepted) don't block a fresh ask later.
    openKnockUnique: uniqueIndex('knocks_open_unique')
      .on(table.kind, table.targetId, table.userId)
      .where(sql`${table.status} = 'pending'`),
    targetIdx: index('knocks_kind_target_idx').on(table.kind, table.targetId),
    userIdIdx: index('knocks_user_id_idx').on(table.userId),
  }),
)

export type Knock = typeof knocks.$inferSelect
export type NewKnock = typeof knocks.$inferInsert
