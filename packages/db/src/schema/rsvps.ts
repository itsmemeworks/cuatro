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
    // How this row's slot was filled: the normal in-circle RSVP tap, or a
    // Fourth Call claim (level 2's extended-network invite, or level 3's
    // public link — see server/fourth-call.ts). Drives the "claimed via
    // Fourth Call" banner instead of the old hasFourthCallInvite heuristic,
    // which could misfire for a regular member who also happened to hold a
    // stale fourth_call notification from a prior escalation.
    source: text('source', { enum: ['rsvp', 'fourth_call'] }).notNull().default('rsvp'),
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
