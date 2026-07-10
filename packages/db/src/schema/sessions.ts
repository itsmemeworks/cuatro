import { sql } from 'drizzle-orm'
import { check, index, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAtColumn, gameTypeColumn, idColumn, timestampColumn } from './_columns.js'
import { circles } from './circles.js'
import { standingGames } from './standing-games.js'
import { venues } from './venues.js'

// A single instance of a Standing Game (or a one-off: standingGameId null).
export const sessions = pgTable(
  'sessions',
  {
    id: idColumn(),
    standingGameId: text('standing_game_id').references(() => standingGames.id),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    venueId: text('venue_id').references(() => venues.id),
    startsAt: timestampColumn('starts_at').notNull(), // UTC
    status: text('status', { enum: ['upcoming', 'played', 'cancelled'] })
      .notNull()
      .default('upcoming'),
    // THE ROTATION lock marker (null until locked). A rotation-enabled session
    // computes a provisional four live from availability, then locks it lazily
    // on the first view at/after T-24h (see server/games-service.ts
    // lockRotationIfDue) — this records the instant that happened. Null on
    // non-rotation sessions and on rotation sessions still gathering availability.
    rotationLockedAt: timestampColumn('rotation_locked_at'),
    // FRIENDLIES (V1-READINESS #10): this occurrence's classification. A standing
    // session inherits it from its Standing Game at materialisation; a one-off
    // inherits the circle default at creation. Snapshotted onto the match at
    // record time (matches.game_type) so the Ledger can explain a no-move seal.
    gameType: gameTypeColumn('game_type'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    circleIdIdx: index('sessions_circle_id_idx').on(table.circleId),
    standingGameIdIdx: index('sessions_standing_game_id_idx').on(table.standingGameId),
    startsAtIdx: index('sessions_starts_at_idx').on(table.startsAt),
    gameTypeCheck: check('sessions_game_type_check', sql`${table.gameType} in ('competitive', 'friendly')`),
  }),
)

export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
