import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { users } from './users.js'

// The product's heartbeat: RSVP opens, promotions, Fourth Calls, result
// confirmations. `payload` is a free-form JSON blob shaped per `type`.
export const notifications = sqliteTable(
  'notifications',
  {
    id: idColumn(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    readAt: timestampColumn('read_at'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    userIdCreatedAtIdx: index('notifications_user_id_created_at_idx').on(
      table.userId,
      table.createdAt,
    ),
  }),
)

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert
