import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { sessions } from './sessions.js'
import { users } from './users.js'

// A single match within a Session. Score is stored as per-set games, e.g.
// [{"a":6,"b":3},{"a":6,"b":4}] — team A's/B's games won in each set.
export type SetScore = { a: number; b: number }

export const matches = sqliteTable(
  'matches',
  {
    id: idColumn(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    teamAPlayer1Id: text('team_a_player1_id')
      .notNull()
      .references(() => users.id),
    teamAPlayer2Id: text('team_a_player2_id')
      .notNull()
      .references(() => users.id),
    teamBPlayer1Id: text('team_b_player1_id')
      .notNull()
      .references(() => users.id),
    teamBPlayer2Id: text('team_b_player2_id')
      .notNull()
      .references(() => users.id),
    score: text('score', { mode: 'json' }).$type<SetScore[]>().notNull(),
    status: text('status', {
      enum: ['pending_confirmation', 'verified', 'disputed', 'void'],
    })
      .notNull()
      .default('pending_confirmation'),
    // Mirrors @cuatro/glass's MatchOutcome — see packages/glass/README.md
    // "Walkover / retired match policy". Stored so the UI can label a
    // partial/early-ended result, and so matches-db.ts can pass the right
    // outcome into the Glass engine at confirmation time.
    outcome: text('outcome', { enum: ['completed', 'retired', 'walkover'] })
      .notNull()
      .default('completed'),
    playedAt: timestampColumn('played_at').notNull(), // UTC
    createdAt: createdAtColumn(),
  },
  (table) => ({
    sessionIdIdx: index('matches_session_id_idx').on(table.sessionId),
    statusIdx: index('matches_status_idx').on(table.status),
  }),
)

// Both teams must confirm before a match's result moves anyone's rating.
// One confirmation row per team per match (whichever player on that team
// confirms first records it for the whole team).
export const matchConfirmations = sqliteTable(
  'match_confirmations',
  {
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    team: text('team', { enum: ['A', 'B'] }).notNull(),
    confirmedByUserId: text('confirmed_by_user_id')
      .notNull()
      .references(() => users.id),
    confirmedAt: createdAtColumn('confirmed_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.matchId, table.team] }),
  }),
)

export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
export type MatchConfirmation = typeof matchConfirmations.$inferSelect
export type NewMatchConfirmation = typeof matchConfirmations.$inferInsert
