import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, idColumn } from './_columns.js'
import { users } from './users.js'

// A Circle is the persistent group: members, chat, history, the Tab, its
// Standing Games. Joined by link or QR only — never by phone number.
export const circles = sqliteTable(
  'circles',
  {
    id: idColumn(),
    name: text('name').notNull(),
    emblem: text('emblem'),
    colour: text('colour'),
    countryCode: text('country_code').notNull().default('GB'),
    timezone: text('timezone').notNull().default('Europe/London'),
    inviteCode: text('invite_code').notNull().unique(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    createdByIdx: index('circles_created_by_idx').on(table.createdBy),
  }),
)

export const circleMembers = sqliteTable(
  'circle_members',
  {
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['organiser', 'member'] })
      .notNull()
      .default('member'),
    joinedAt: createdAtColumn('joined_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.circleId, table.userId] }),
    userIdIdx: index('circle_members_user_id_idx').on(table.userId),
  }),
)

export type Circle = typeof circles.$inferSelect
export type NewCircle = typeof circles.$inferInsert
export type CircleMember = typeof circleMembers.$inferSelect
export type NewCircleMember = typeof circleMembers.$inferInsert
