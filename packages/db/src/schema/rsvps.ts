import { index, integer, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { sessions } from './sessions.js'
import { users } from './users.js'

// One RSVP row per (session, user). `position` orders the reserve queue for
// auto-promotion when a confirmed player drops out.
export const rsvps = pgTable(
  'rsvps',
  {
    id: idColumn(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    // 'available' is THE ROTATION's pre-lock state: in a rotation-enabled game
    // you declare availability rather than grabbing a slot, so an availability
    // reply sits as 'available' until lock turns it into 'in' (selected to
    // play) or 'reserve' (sitting out this week, first to auto-promote). Plain
    // first-come games never use it. Text column, no DB CHECK constraint (see
    // migration 0000) — adding the value is a schema-level change only.
    status: text('status', { enum: ['in', 'out', 'reserve', 'available'] }).notNull(),
    position: integer('position'), // reserve queue order; null unless status = 'reserve'
    // How this row's slot was filled: the normal in-circle RSVP tap, a
    // Fourth Call claim (level 2's extended-network invite, or level 3's
    // public link — see server/fourth-call.ts), or an anonymous guest claim
    // on that same public link (see server/guest.ts). Drives the "claimed
    // via Fourth Call" banner instead of the old hasFourthCallInvite
    // heuristic, which could misfire for a regular member who also happened
    // to hold a stale fourth_call notification from a prior escalation.
    source: text('source', { enum: ['rsvp', 'fourth_call', 'guest_link'] }).notNull().default('rsvp'),
    respondedAt: createdAtColumn('responded_at'),
    promotedAt: timestampColumn('promoted_at'),
    cancelledAt: timestampColumn('cancelled_at'),
    // Soft hold on a guest_link claim — set to claim-time + 5:00, per the
    // "Spot held ... for 5:00 while you type" copy. Only ever set (and only
    // ever consulted) for `source: 'guest_link'` rows: another claim
    // attempt on a full session sweeps any 'in' row past its holdExpiresAt
    // back to 'out' before counting confirmed slots (see server/guest.ts's
    // sweepExpiredHolds), freeing it for a new claimant. Cleared the moment
    // the guest locks in their name — from then on the row behaves exactly
    // like any other confirmed RSVP.
    holdExpiresAt: timestampColumn('hold_expires_at'),
  },
  (table) => ({
    sessionUserUnique: unique('rsvps_session_user_unique').on(table.sessionId, table.userId),
    sessionIdIdx: index('rsvps_session_id_idx').on(table.sessionId),
    userIdIdx: index('rsvps_user_id_idx').on(table.userId),
  }),
)

export type Rsvp = typeof rsvps.$inferSelect
export type NewRsvp = typeof rsvps.$inferInsert
