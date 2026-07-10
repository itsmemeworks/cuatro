import { index, jsonb, real, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAtColumn, idColumn } from './_columns.js'
import { matches } from './matches.js'
import { users } from './users.js'

// THE LEDGER — GLASS's append-only, user-visible history. Every verified
// match writes one row per player here; nothing is ever updated or deleted.
// `explanation` is the human-readable Ledger line, e.g.
// "+0.02 · beat a slightly stronger pair, comfortable margin · vs J, K (first meeting — full weight)".
export type RatingEventFactors = {
  expectedWin: number
  marginMultiplier: number
  echoDampingMultiplier: number
  kFactor: number
  opponentUserIds: string[]
  isFirstMeeting: boolean
}

export const ratingEvents = pgTable(
  'rating_events',
  {
    id: idColumn(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    delta: real('delta').notNull(),
    ratingBefore: real('rating_before'), // null only for a user's very first rating event
    // The Ledger tracks a real internal number even during the Placement Trio
    // (before it's revealed as the user's public `users.rating`), so this is
    // always set — the "Unrated" state lives in `users.rating`, not here.
    ratingAfter: real('rating_after').notNull(),
    confidenceBefore: real('confidence_before').notNull(),
    confidenceAfter: real('confidence_after').notNull(),
    factors: jsonb('factors').$type<RatingEventFactors>().notNull(),
    explanation: text('explanation').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    userIdCreatedAtIdx: index('rating_events_user_id_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
    matchIdIdx: index('rating_events_match_id_idx').on(table.matchId),
  }),
)

export type RatingEvent = typeof ratingEvents.$inferSelect
export type NewRatingEvent = typeof ratingEvents.$inferInsert
