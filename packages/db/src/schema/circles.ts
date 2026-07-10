import { sql } from 'drizzle-orm'
import { bigint, check, index, integer, primaryKey, pgTable, text } from 'drizzle-orm/pg-core'
import { booleanColumn, createdAtColumn, gameTypeColumn, idColumn, timestampColumn } from './_columns.js'
import { users } from './users.js'
import { venues } from './venues.js'

// A Circle is the persistent group: members, chat, history, the Tab, its
// Standing Games. Joined by link or QR only — never by phone number.
export const circles = pgTable(
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

    // Circle v2 presentation + membership controls.
    // `headerImage` is a curated-collection KEY (e.g. "court-03"), NOT a URL —
    // the actual asset ships in apps/web/public/circle-headers and is resolved
    // client-side (offline PWA + CSP forbid hotlinking). Null means "no explicit
    // choice yet"; the UI falls back to a deterministic auto-assignment
    // (headerFor(circleId)) so every Circle has a stable header without a
    // backfill. `homeVenueId` is the organiser's EXPLICIT home club — it takes
    // priority over the derived most-used-venue anchor (see server/open-door.ts
    // circleAnchor) when it is set AND that venue is pinned. `maxMembers` caps
    // the roster (null = uncapped); it is enforced in the same transaction as
    // every membership insert (circle_full).
    headerImage: text('header_image'),
    homeVenueId: text('home_venue_id').references(() => venues.id),
    maxMembers: integer('max_members'),

    // FRIENDLIES (V1-READINESS #10): the circle's default game classification —
    // the top of the inheritance chain (see _columns.ts gameTypeColumn). New
    // Standing Games / one-offs adopt this unless the organiser overrides.
    defaultGameType: gameTypeColumn('default_game_type'),

    createdAt: createdAtColumn(),
  },
  (table) => ({
    createdByIdx: index('circles_created_by_idx').on(table.createdBy),
    defaultGameTypeCheck: check(
      'circles_default_game_type_check',
      sql`${table.defaultGameType} in ('competitive', 'friendly')`,
    ),
  }),
)

export const circleMembers = pgTable(
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
// see DESIGN.md's Build plan M1). NOTE (Postgres): there is no implicit rowid
// to break `created_at` (ms-resolution) ties the way SQLite did — queries that
// need a stable order within the same millisecond must add a deterministic
// tiebreaker (e.g. `order by created_at, id`). See the foundation manifest.
export const circleMessages = pgTable(
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
    // Monotonic insertion-order key. SQLite's implicit rowid used to break
    // `created_at` (ms-resolution) ties for chat ordering; Postgres has no
    // rowid, so this GENERATED-ALWAYS identity column replaces it. Chat
    // queries order by this, not created_at. (App-facing addition: rows now
    // carry a `seq: number`.)
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
  },
  (table) => ({
    circleIdCreatedAtIdx: index('circle_messages_circle_id_created_at_idx').on(
      table.circleId,
      table.createdAt,
    ),
    circleIdSeqIdx: index('circle_messages_circle_id_seq_idx').on(table.circleId, table.seq),
  }),
)

export type Circle = typeof circles.$inferSelect
export type NewCircle = typeof circles.$inferInsert
export type CircleMember = typeof circleMembers.$inferSelect
export type NewCircleMember = typeof circleMembers.$inferInsert
export type CircleMessage = typeof circleMessages.$inferSelect
export type NewCircleMessage = typeof circleMessages.$inferInsert
