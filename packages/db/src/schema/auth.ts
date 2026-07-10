import { index, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { users } from './users.js'

// Phone-agnostic auth (email magic link + Apple/Google OAuth) — no SMS
// dependency that breaks abroad. Tokens are stored hashed, never in the clear.
export const magicLinkTokens = pgTable(
  'magic_link_tokens',
  {
    id: idColumn(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    usedAt: timestampColumn('used_at'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    emailIdx: index('magic_link_tokens_email_idx').on(table.email),
  }),
)

// Cookie session store. Table name is `sessions_auth` (not `sessions`) to
// avoid colliding with the game-instance `sessions` table.
export const authSessions = pgTable(
  'sessions_auth',
  {
    id: idColumn(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: timestampColumn('expires_at').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    userIdIdx: index('sessions_auth_user_id_idx').on(table.userId),
  }),
)

export type MagicLinkToken = typeof magicLinkTokens.$inferSelect
export type NewMagicLinkToken = typeof magicLinkTokens.$inferInsert
export type AuthSession = typeof authSessions.$inferSelect
export type NewAuthSession = typeof authSessions.$inferInsert
