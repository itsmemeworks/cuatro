import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createdAtColumn, idColumn, timestampColumn } from './_columns.js'
import { circles } from './circles.js'
import { sessions } from './sessions.js'
import { users } from './users.js'

// Zero-platform-risk money: Cuatro never holds funds. One running Tab per
// Circle records who owes whom; settlement is marked by counterparty
// confirmation, not by moving real money through the app.
export const tabs = sqliteTable(
  'tabs',
  {
    id: idColumn(),
    circleId: text('circle_id')
      .notNull()
      .references(() => circles.id)
      .unique(),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    circleIdIdx: index('tabs_circle_id_idx').on(table.circleId),
  }),
)

// World-ready rule: every money value is amount_minor + currency (ISO 4217),
// never a float. `amountMinor` is what `debtorUserId` owes `payerUserId`.
export const tabEntries = sqliteTable(
  'tab_entries',
  {
    id: idColumn(),
    tabId: text('tab_id')
      .notNull()
      .references(() => tabs.id),
    sessionId: text('session_id').references(() => sessions.id),
    payerUserId: text('payer_user_id')
      .notNull()
      .references(() => users.id),
    debtorUserId: text('debtor_user_id')
      .notNull()
      .references(() => users.id),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('GBP'),
    // "court + new balls" / "from Tuesday's court + balls" (design's Tab
    // screens) — what the money was for, in the payer's own words. Null for
    // an entry with no description yet; callers derive a session-date
    // fallback label themselves rather than inventing one here (see
    // server/tab.ts's descriptionLabel).
    description: text('description'),
    status: text('status', { enum: ['open', 'nudged', 'settled'] })
      .notNull()
      .default('open'),
    settledConfirmedBy: text('settled_confirmed_by').references(() => users.id),
    createdAt: createdAtColumn(),
    nudgedAt: timestampColumn('nudged_at'),
    settledAt: timestampColumn('settled_at'),
  },
  (table) => ({
    tabIdIdx: index('tab_entries_tab_id_idx').on(table.tabId),
    debtorIdIdx: index('tab_entries_debtor_user_id_idx').on(table.debtorUserId),
  }),
)

export type Tab = typeof tabs.$inferSelect
export type NewTab = typeof tabs.$inferInsert
export type TabEntry = typeof tabEntries.$inferSelect
export type NewTabEntry = typeof tabEntries.$inferInsert
