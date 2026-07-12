/**
 * The one place every notification gets written and worded. Centralizes:
 *  - typed payloads per notification type (previously every writer inlined
 *    its own `payload: {...}` shape with no shared contract — see
 *    games-service.ts and matches-db.ts, which now call insertNotification()
 *    below instead of inserting into `notifications` directly),
 *  - the copy rules from design/HANDOFF.md screen 11: title says WHAT, body
 *    says WHY, no exclamation marks from the system. ("Never nag twice" is
 *    enforced by each call site's own idempotency check — e.g.
 *    checkFourthCallLevel1/2's "already notified" guards — not here; this
 *    module only renders copy and writes rows, it doesn't decide whether a
 *    write should happen.)
 *  - best-effort web push delivery via ../lib/push, deferred until after the
 *    caller's transaction has committed.
 *  - a realtime broadcast to the recipient's `cuatro:user:{userId}` channel
 *    (see ../lib/realtime), which is what drives the notification bell's
 *    live unread count — every notification type funnels through here, so
 *    this one hook covers all of them (fourth call, Glass moved, placement
 *    complete, tab nudge, ...) without each caller needing its own emit.
 *
 * insertNotification() is an async drop-in for the old
 * `tx.insert(notifications).values({...}).run()` call sites: same DB
 * effect, `await`ed from inside games-service.ts's and matches-db.ts's
 * `await db.transaction(async (tx) => {...})` bodies (Postgres transactions
 * are async — awaits inside the callback are correct and required). Push
 * delivery still can't happen inside the transaction (webpush.sendNotification
 * is async and must not gate the commit), so it's scheduled with
 * `setImmediate`, which runs after the transaction body's microtasks settle
 * and the commit lands. If the surrounding transaction later threw for an
 * unrelated reason *after* this insert ran, a push could in theory fire for a
 * write that got rolled back; every call site writes its notification as the
 * last statement in its transaction, so in practice that window doesn't
 * occur. Documented limitation, not solved generically. The realtime
 * broadcast piggybacks on the same setImmediate for the same "after commit"
 * reason.
 */
import { eq } from "drizzle-orm";
import { notifications, sessions, circles, users, venues, type CuatroDb, type Notification } from "@cuatro/db";
import { sendPushToUser } from "@/lib/push";
import { emitUserEvent } from "@/lib/realtime/broadcast";
import { formatMoneyWhole } from "@/components/tab/money";
import { formatDateTime, DEFAULT_TZ } from "@/lib/time";

export type NotificationInput =
  | { type: "game_filled"; payload: { sessionId: string } }
  | { type: "slot_promoted"; payload: { sessionId: string } }
  | { type: "dropout"; payload: { sessionId: string; userId: string } }
  | {
      type: "fourth_call";
      // level 1 = own circle; level 2 = beyond it. `via: "played_with"` marks the
      // played-with ring (people from your verified matches) vs the geo Local Ring.
      payload: { sessionId: string; level: 1 | 2; via?: "played_with" | "rotation_offer" };
    }
  | { type: "placement_complete"; payload: { matchId: string; rating: number | null } }
  | { type: "result_verified"; payload: { matchId: string; delta: number; explanation: string } }
  | { type: "result_disputed"; payload: { matchId: string } }
  | { type: "confirm_result"; payload: { matchId: string; sessionId: string } }
  | { type: "match_comment"; payload: { matchId: string; commenterId: string } }
  | {
      type: "tab_nudge";
      payload: { circleId: string; tabEntryId: string; amountMinor: number; currency: string };
    }
  | { type: "tab_settled"; payload: { entryId: string; confirmedBy: string } }
  | { type: "session_rescheduled"; payload: { sessionId: string } }
  | { type: "rotation_selected"; payload: { sessionId: string } }
  | { type: "rotation_sitting_out"; payload: { sessionId: string } }
  | { type: "knock_received"; payload: { knockId: string; kind: "circle" | "session"; targetId: string; userId: string } }
  | { type: "knock_accepted"; payload: { knockId: string; kind: "circle" | "session"; targetId: string } }
  | { type: "knock_declined"; payload: { knockId: string; kind: "circle" | "session"; targetId: string } }
  | { type: "member_removed"; payload: { circleId: string } }
  | { type: "organiser_transferred"; payload: { circleId: string; fromUserId: string } };

export type NotificationType = NotificationInput["type"];
export type PayloadFor<T extends NotificationType> = Extract<NotificationInput, { type: T }>["payload"];

export type InsertNotificationInput = { userId: string } & NotificationInput;

export interface NotificationCopy {
  title: string;
  body: string;
}

function fmtDelta(delta: number): string {
  if (delta === 0) return "0.00"; // fully-damped result: no sign, never a lying "+"
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
}

/** Circle name + a human "Tue 20 Jul, 20:00" timestamp for a session, or null if the session's gone. The time renders in the session's effective timezone (venue's, else the Circle's — server/week.ts precedent): notification bodies are stored strings, so a raw-UTC render here would bake an hour-early time in permanently (the QA4 class). */
async function sessionContext(tx: CuatroDb, sessionId: string): Promise<{ circleName: string; when: string } | null> {
  const [session] = await tx.select().from(sessions).where(eq(sessions.id, sessionId));
  if (!session) return null;
  const [circle] = await tx
    .select({ name: circles.name, timezone: circles.timezone })
    .from(circles)
    .where(eq(circles.id, session.circleId));
  const [venue] = session.venueId
    ? await tx.select({ timezone: venues.timezone }).from(venues).where(eq(venues.id, session.venueId))
    : [];
  const when = formatDateTime(session.startsAt, venue?.timezone ?? circle?.timezone ?? DEFAULT_TZ);
  return { circleName: circle?.name ?? "your Circle", when };
}

/**
 * Renders the title (what) + body (why) for a notification, per
 * design/HANDOFF.md screen 11. No branch ever emits "!" — padel results and
 * money nudges read as facts, not hype. Takes `tx` (rather than requiring
 * denormalised context in the payload) so both the writer
 * (insertNotification) and the reader (notifications.ts's list model) get
 * identical copy from the same stored payload.
 */
export async function renderNotificationCopy(tx: CuatroDb, input: NotificationInput): Promise<NotificationCopy> {
  switch (input.type) {
    case "game_filled": {
      const ctx = await sessionContext(tx, input.payload.sessionId);
      return {
        title: "Your four is set",
        body: ctx ? `All slots filled for ${ctx.circleName}, ${ctx.when}.` : "All slots are filled for your next game.",
      };
    }
    case "slot_promoted": {
      const ctx = await sessionContext(tx, input.payload.sessionId);
      return {
        title: "You're in",
        body: ctx
          ? `A slot opened up for ${ctx.circleName}, ${ctx.when}. You've been promoted from reserve.`
          : "A slot opened up and you've been promoted from reserve.",
      };
    }
    case "dropout": {
      const ctx = await sessionContext(tx, input.payload.sessionId);
      const [dropped] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.payload.userId));
      return {
        title: "A slot just opened",
        body: ctx
          ? `${dropped?.displayName ?? "Someone"} dropped out of ${ctx.circleName}, ${ctx.when}. No reserve to promote yet, so consider a Fourth Call.`
          : "Someone dropped out and there's no reserve to promote yet.",
      };
    }
    case "fourth_call": {
      const ctx = await sessionContext(tx, input.payload.sessionId);
      if (input.payload.via === "rotation_offer") {
        return {
          title: "A spot opened in your four",
          body: ctx
            ? `Someone dropped out of ${ctx.circleName}, ${ctx.when}. You're next in the rotation. Still good to play?`
            : "Someone dropped out and you're next in the rotation. Still good to play?",
        };
      }
      if (input.payload.via === "played_with") {
        return {
          title: "A four you know needs a player",
          body: ctx
            ? `${ctx.circleName} is short for ${ctx.when}. You've played with this lot before. Tap in if you can make it.`
            : "A game with people you've played with is short a player.",
        };
      }
      return input.payload.level === 1
        ? {
            title: "Your circle needs a fourth",
            body: ctx
              ? `${ctx.circleName} is short for ${ctx.when}. Tap in if you can make it.`
              : "A game in your Circle is short a player.",
          }
        : {
            title: "A four near you needs a player",
            body: ctx
              ? `${ctx.circleName}'s game on ${ctx.when} is short and your Glass is a close match. Tap in if you can play.`
              : "A nearby game is short a player and your Glass is a close match.",
          };
    }
    case "placement_complete": {
      const rating = input.payload.rating;
      return {
        title: "Your Glass number is live",
        body:
          rating != null
            ? `Placement Trio complete. You're rated ${rating.toFixed(2)}. Tap to see your Ledger.`
            : "Placement Trio complete. Tap to see your Ledger.",
      };
    }
    case "result_verified": {
      return {
        title: "Your Glass moved",
        body: `${fmtDelta(input.payload.delta)}. Both teams confirmed. Tap to see exactly why.`,
      };
    }
    case "result_disputed": {
      return {
        title: "A result was disputed",
        body: "Glass won't move on this match until the dispute is resolved. Tap to see both sides.",
      };
    }
    case "confirm_result": {
      const ctx = await sessionContext(tx, input.payload.sessionId);
      return {
        title: "Confirm your result",
        body: ctx
          ? `The other team logged your score for ${ctx.circleName}, ${ctx.when}. Confirm so Glass can move for everyone.`
          : "The other team logged your score. Confirm so Glass can move for everyone.",
      };
    }
    case "tab_settled": {
      const [confirmer] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.payload.confirmedBy));
      return {
        title: "Settled up",
        body: `${confirmer?.displayName ?? "Your counterpart"} confirmed you're square. The Tab agrees.`,
      };
    }
    case "tab_nudge": {
      return {
        title: "You've got a Tab nudge",
        body: `${formatMoneyWhole(input.payload.amountMinor, input.payload.currency)} outstanding on the Tab. Settle when you can.`,
      };
    }
    case "rotation_selected": {
      const ctx = await sessionContext(tx, input.payload.sessionId);
      return {
        title: "You're in this week",
        body: ctx
          ? `The Rotation picked this week's four for ${ctx.circleName}, ${ctx.when}. You're playing.`
          : "The Rotation picked you to play this week.",
      };
    }
    case "rotation_sitting_out": {
      const ctx = await sessionContext(tx, input.payload.sessionId);
      return {
        title: "You're sitting this one out",
        body: ctx
          ? `The Rotation has this week's four for ${ctx.circleName}, ${ctx.when}. You're first in if anyone drops, and first to play next week.`
          : "You're sitting this week out. You're first in next week.",
      };
    }
    case "session_rescheduled": {
      const ctx = await sessionContext(tx, input.payload.sessionId);
      return {
        title: "Your game moved",
        body: ctx
          ? `${ctx.circleName}'s game is now ${ctx.when}. Same game, new slot.`
          : "The organiser moved your game to a new slot. Tap for the new time.",
      };
    }
    case "knock_received": {
      const [knocker] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, input.payload.userId));
      const who = knocker?.displayName ?? "Someone";
      if (input.payload.kind === "circle") {
        const [circle] = await tx.select({ name: circles.name }).from(circles).where(eq(circles.id, input.payload.targetId));
        return {
          title: "Someone wants to join your Circle",
          body: `${who} asked to join ${circle?.name ?? "your Circle"}. Tap to decide.`,
        };
      }
      const ctx = await sessionContext(tx, input.payload.targetId);
      return {
        title: "Someone wants in on your game",
        body: ctx ? `${who} asked to join ${ctx.circleName}, ${ctx.when}. Tap to decide.` : `${who} asked to join your game. Tap to decide.`,
      };
    }
    case "knock_accepted": {
      if (input.payload.kind === "circle") {
        const [circle] = await tx.select({ name: circles.name }).from(circles).where(eq(circles.id, input.payload.targetId));
        return {
          title: "You're in",
          body: `${circle?.name ?? "The Circle"} said yes. Welcome in.`,
        };
      }
      const ctx = await sessionContext(tx, input.payload.targetId);
      return {
        title: "You're in",
        body: ctx ? `You're playing with ${ctx.circleName}, ${ctx.when}. See you on court.` : "Your ask was accepted. See you on court.",
      };
    }
    case "knock_declined": {
      return input.payload.kind === "circle"
        ? {
            title: "No room this time",
            body: "That Circle can't take new players right now. Other Circles near you are open.",
          }
        : {
            title: "That game filled up",
            body: "The slot went another way this time. The Board will have more games near you.",
          };
    }
    case "match_comment": {
      const [commenter] = await tx
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, input.payload.commenterId));
      return {
        title: "A comment on your result",
        body: `${commenter?.displayName ?? "Someone"} commented on a match you played. Tap to read it.`,
      };
    }
    case "member_removed": {
      const [circle] = await tx.select({ name: circles.name }).from(circles).where(eq(circles.id, input.payload.circleId));
      return {
        title: "You're no longer in this Circle",
        body: `An organiser removed you from ${circle?.name ?? "the Circle"}. Your match history and Ledger stay with you.`,
      };
    }
    case "organiser_transferred": {
      const [circle] = await tx.select({ name: circles.name }).from(circles).where(eq(circles.id, input.payload.circleId));
      const [from] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.payload.fromUserId));
      return {
        title: "You're the organiser now",
        body: `${from?.displayName ?? "The previous organiser"} handed ${circle?.name ?? "the Circle"} to you. Settings, members and the door are yours.`,
      };
    }
    default: {
      // Exhaustiveness backstop: a (type, payload) that reaches here came
      // from data, not from the union — fail with a name, not a property
      // read on undefined.
      const t = (input as { type?: string }).type;
      throw new Error(`renderNotificationCopy: no copy for notification type "${t}"`);
    }
  }
}

/** Where tapping a notification for `input` should land. */
export function deepLinkFor(input: NotificationInput): string {
  switch (input.type) {
    case "game_filled":
    case "slot_promoted":
    case "fourth_call":
      return `/games/${input.payload.sessionId}`;
    case "dropout":
      return `/games/${input.payload.sessionId}`;
    case "placement_complete":
    case "result_verified":
      return "/profile/ledger";
    case "result_disputed":
    case "confirm_result":
    case "match_comment":
      return `/matches/${input.payload.matchId}`;
    case "tab_nudge":
      return `/circles/${input.payload.circleId}`;
    case "tab_settled":
      return "/tab";
    case "session_rescheduled":
    case "rotation_selected":
    case "rotation_sitting_out":
      return `/games/${input.payload.sessionId}`;
    case "knock_received":
      // The circle-knock accept UI lives on the Settings tab (organiser-only),
      // so "tap to decide" must land there, not on the Feed (v1 audit,
      // journeys finding 3). circle-tabs reads ?tab= as its initial tab.
      return input.payload.kind === "circle" ? `/circles/${input.payload.targetId}?tab=settings` : `/games/${input.payload.targetId}`;
    case "knock_accepted":
      return input.payload.kind === "circle" ? `/circles/${input.payload.targetId}` : `/games/${input.payload.targetId}`;
    case "knock_declined":
      return input.payload.kind === "circle" ? "/circles" : "/home";
    case "member_removed":
      return "/circles";
    case "organiser_transferred":
      return `/circles/${input.payload.circleId}?tab=settings`;
  }
}

function schedulePush(userId: string, copy: NotificationCopy, url: string): void {
  setImmediate(() => {
    sendPushToUser(userId, { title: copy.title, body: copy.body, url }).catch(() => {
      // Best-effort: an unconfigured VAPID key, an expired subscription, or
      // a delivery failure must never surface here — the in-app
      // notification this call already wrote is the source of truth.
    });
  });
}

function scheduleRealtimeBroadcast(userId: string, notificationId: string, type: NotificationType): void {
  setImmediate(() => {
    emitUserEvent(userId, "notification", { notificationId, notificationType: type });
  });
}

/**
 * Drop-in for `tx.insert(notifications).values({...}).run()`. Same insert,
 * plus centralised copy + a best-effort push (see file header for why push
 * is deferred rather than awaited).
 */
export async function insertNotification(tx: CuatroDb, input: InsertNotificationInput): Promise<Notification> {
  const { userId, ...rest } = input;
  const [row] = await tx.insert(notifications).values({ userId, type: rest.type, payload: rest.payload }).returning();
  const copy = await renderNotificationCopy(tx, rest);
  schedulePush(userId, copy, deepLinkFor(rest));
  scheduleRealtimeBroadcast(userId, row.id, rest.type);
  return row;
}
