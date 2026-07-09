import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { booleanColumn, createdAtColumn, idColumn, timestampColumn } from './_columns.js'
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

    // Geo discovery controls (both on-by-default, per the greenlit design).
    // `boardEnabled`: this Circle surfaces on The Board (the nearby-groups
    // discovery surface). `openDoor`: the Circle accepts knocks from players
    // who found it — the "open door" affordance in the directory. `vibeLine`
    // is one warm sentence shown on the directory card (e.g. "Chilled
    // Tuesday doubles, all levels welcome"); null until an organiser writes it.
    boardEnabled: booleanColumn('board_enabled').notNull().default(true),
    openDoor: booleanColumn('open_door').notNull().default(true),
    vibeLine: text('vibe_line'),

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
    // Chat unread tracking (design/DESIGN-AUDIT.md F3): null means "never
    // opened this Circle's chat" — every message counts as unread until the
    // first markCircleRead() call, not zero of them.
    lastReadAt: timestampColumn('last_read_at'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.circleId, table.userId] }),
    userIdIdx: index('circle_members_user_id_idx').on(table.userId),
  }),
)

// A Circle's chat. Flat and text-only at v0 (no replies/reactions/threads —
// see DESIGN.md's Build plan M1); ordering ties on `created_at` (ms
// resolution) are broken by SQLite's implicit rowid, which is always
// strictly increasing in insertion order for a rowid table like this one.
export const circleMessages = sqliteTable(
  'circle_messages',
  {
    id: idColumn(),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    circleIdCreatedAtIdx: index('circle_messages_circle_id_created_at_idx').on(
      table.circleId,
      table.createdAt,
    ),
  }),
)

export type Circle = typeof circles.$inferSelect
export type NewCircle = typeof circles.$inferInsert
export type CircleMember = typeof circleMembers.$inferSelect
export type NewCircleMember = typeof circleMembers.$inferInsert
export type CircleMessage = typeof circleMessages.$inferSelect
export type NewCircleMessage = typeof circleMessages.$inferInsert
