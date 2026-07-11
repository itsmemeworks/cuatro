import { index, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { users } from './users.js'

// Web-push endpoints, so "CUATRO nags so nobody has to" survives a deploy:
// the old in-memory Map died with every release. Keyed on `endpoint` (unique),
// NOT user — one user can have several devices, and a browser re-subscribing
// re-presents the same endpoint, so the subscribe path upserts on it. The FK
// cascades: delete a user, their push rows go too. `lastUsedAt` is stamped on
// every successful send; a 404/410 from the push service means the endpoint
// expired and its row is deleted (standard web-push expiry handling).
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: idColumn(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    keysP256dh: text('keys_p256dh').notNull(),
    keysAuth: text('keys_auth').notNull(),
    createdAt: createdAtColumn(),
    lastUsedAt: timestampColumn('last_used_at'),
  },
  (table) => ({
    userIdIdx: index('push_subscriptions_user_id_idx').on(table.userId),
  }),
)

export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert
