import { index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { sessions } from './sessions.js'
import { users } from './users.js'

// One RSVP row per (session, user). `position` orders the reserve queue for
// auto-promotion when a confirmed player drops out.
export const rsvps = sqliteTable(
  'rsvps',
  {
    id: idColumn(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: ['in', 'out', 'reserve'] }).notNull(),
    position: integer('position'), // reserve queue order; null unless status = 'reserve'
    respondedAt: createdAtColumn('responded_at'),
    promotedAt: timestampColumn('promoted_at'),
    cancelledAt: timestampColumn('cancelled_at'),
  },
  (table) => ({
    sessionUserUnique: unique('rsvps_session_user_unique').on(table.sessionId, table.userId),
    sessionIdIdx: index('rsvps_session_id_idx').on(table.sessionId),
    userIdIdx: index('rsvps_user_id_idx').on(table.userId),
  }),
)

export type Rsvp = typeof rsvps.$inferSelect
export type NewRsvp = typeof rsvps.$inferInsert
