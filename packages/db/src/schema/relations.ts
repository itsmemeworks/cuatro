import { relations } from 'drizzle-orm'
import { circleMembers, circles } from './circles.js'
import { matchConfirmations, matches } from './matches.js'
import { notifications } from './notifications.js'
import { ratingEvents } from './rating-events.js'
import { rsvps } from './rsvps.js'
import { sessions } from './sessions.js'
import { standingGames } from './standing-games.js'
import { tabEntries, tabs } from './tabs.js'
import { users } from './users.js'
import { venues } from './venues.js'

export const usersRelations = relations(users, ({ many }) => ({
  circleMemberships: many(circleMembers),
  rsvps: many(rsvps),
  ratingEvents: many(ratingEvents),
  notifications: many(notifications),
}))

export const circlesRelations = relations(circles, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [circles.createdBy],
    references: [users.id],
  }),
  members: many(circleMembers),
  standingGames: many(standingGames),
  sessions: many(sessions),
  tab: one(tabs, {
    fields: [circles.id],
    references: [tabs.circleId],
  }),
}))

export const circleMembersRelations = relations(circleMembers, ({ one }) => ({
  circle: one(circles, {
    fields: [circleMembers.circleId],
    references: [circles.id],
  }),
  user: one(users, {
    fields: [circleMembers.userId],
    references: [users.id],
  }),
}))

export const venuesRelations = relations(venues, ({ many }) => ({
  standingGames: many(standingGames),
  sessions: many(sessions),
}))

export const standingGamesRelations = relations(standingGames, ({ one, many }) => ({
  circle: one(circles, {
    fields: [standingGames.circleId],
    references: [circles.id],
  }),
  venue: one(venues, {
    fields: [standingGames.venueId],
    references: [venues.id],
  }),
  sessions: many(sessions),
}))

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  standingGame: one(standingGames, {
    fields: [sessions.standingGameId],
    references: [standingGames.id],
  }),
  circle: one(circles, {
    fields: [sessions.circleId],
    references: [circles.id],
  }),
  venue: one(venues, {
    fields: [sessions.venueId],
    references: [venues.id],
  }),
  rsvps: many(rsvps),
  matches: many(matches),
  tabEntries: many(tabEntries),
}))

export const rsvpsRelations = relations(rsvps, ({ one }) => ({
  session: one(sessions, {
    fields: [rsvps.sessionId],
    references: [sessions.id],
  }),
  user: one(users, {
    fields: [rsvps.userId],
    references: [users.id],
  }),
}))

export const matchesRelations = relations(matches, ({ one, many }) => ({
  session: one(sessions, {
    fields: [matches.sessionId],
    references: [sessions.id],
  }),
  teamAPlayer1: one(users, {
    fields: [matches.teamAPlayer1Id],
    references: [users.id],
  }),
  teamAPlayer2: one(users, {
    fields: [matches.teamAPlayer2Id],
    references: [users.id],
  }),
  teamBPlayer1: one(users, {
    fields: [matches.teamBPlayer1Id],
    references: [users.id],
  }),
  teamBPlayer2: one(users, {
    fields: [matches.teamBPlayer2Id],
    references: [users.id],
  }),
  confirmations: many(matchConfirmations),
  ratingEvents: many(ratingEvents),
}))

export const matchConfirmationsRelations = relations(matchConfirmations, ({ one }) => ({
  match: one(matches, {
    fields: [matchConfirmations.matchId],
    references: [matches.id],
  }),
  confirmedByUser: one(users, {
    fields: [matchConfirmations.confirmedByUserId],
    references: [users.id],
  }),
}))

export const ratingEventsRelations = relations(ratingEvents, ({ one }) => ({
  user: one(users, {
    fields: [ratingEvents.userId],
    references: [users.id],
  }),
  match: one(matches, {
    fields: [ratingEvents.matchId],
    references: [matches.id],
  }),
}))

export const tabsRelations = relations(tabs, ({ one, many }) => ({
  circle: one(circles, {
    fields: [tabs.circleId],
    references: [circles.id],
  }),
  entries: many(tabEntries),
}))

export const tabEntriesRelations = relations(tabEntries, ({ one }) => ({
  tab: one(tabs, {
    fields: [tabEntries.tabId],
    references: [tabs.id],
  }),
  session: one(sessions, {
    fields: [tabEntries.sessionId],
    references: [sessions.id],
  }),
  payer: one(users, {
    fields: [tabEntries.payerUserId],
    references: [users.id],
  }),
  debtor: one(users, {
    fields: [tabEntries.debtorUserId],
    references: [users.id],
  }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, {
    fields: [notifications.userId],
    references: [users.id],
  }),
}))
