import { index, jsonb, primaryKey, pgTable, text, unique } from 'drizzle-orm/pg-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { sessions } from './sessions.js'
import { users } from './users.js'

// A single match within a Session. Score is stored as per-set games, e.g.
// [{"a":6,"b":3},{"a":6,"b":4}] — team A's/B's games won in each set.
export type SetScore = { a: number; b: number }

export const matches = pgTable(
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
    score: jsonb('score').$type<SetScore[]>().notNull(),
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
export const matchConfirmations = pgTable(
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

// A member's 👏 Respect tap on a verified match's Feed result post. `kind`
// is a fixed enum of one value today (only Respect exists in v0 — see
// design/HANDOFF.md screen 4), kept as a column rather than a boolean flag
// so a second reaction kind can land later without a new table. One row per
// (match, user, kind): the unique index is both the storage for "did this
// user already react" and what makes the toggle endpoint idempotent.
export const matchReactions = pgTable(
  'match_reactions',
  {
    id: idColumn(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ['respect'] }).notNull().default('respect'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    matchUserKindUnique: unique('match_reactions_match_user_kind_unique').on(
      table.matchId,
      table.userId,
      table.kind,
    ),
    matchIdIdx: index('match_reactions_match_id_idx').on(table.matchId),
  }),
)

// 💬 comments on a verified match's Feed result post (design/DESIGN-AUDIT.md
// F1). Flat, no replies/threads at v0 — same shape choice circle_messages
// made (see circles.ts). Body length (≤1000) is enforced app-side (see
// server/comments.ts's MAX_COMMENT_LENGTH), not a DB CHECK constraint —
// matching circle_messages' MAX_MESSAGE_LENGTH precedent.
export const matchComments = pgTable(
  'match_comments',
  {
    id: idColumn(),
    matchId: text('match_id')
      .notNull()
      .references(() => matches.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    matchIdCreatedAtIdx: index('match_comments_match_id_created_at_idx').on(table.matchId, table.createdAt),
  }),
)

export type Match = typeof matches.$inferSelect
export type NewMatch = typeof matches.$inferInsert
export type MatchConfirmation = typeof matchConfirmations.$inferSelect
export type NewMatchConfirmation = typeof matchConfirmations.$inferInsert
export type MatchReaction = typeof matchReactions.$inferSelect
export type NewMatchReaction = typeof matchReactions.$inferInsert
export type MatchComment = typeof matchComments.$inferSelect
export type NewMatchComment = typeof matchComments.$inferInsert
