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
 * insertNotification() is a synchronous drop-in for the old
 * `tx.insert(notifications).values({...}).run()` call sites: same DB
 * effect, callable from inside games-service.ts's and matches-db.ts's
 * existing `db.transaction((tx) => {...})` bodies (see those files' headers
 * for why the callback must stay fully synchronous — better-sqlite3
 * requires it). Push delivery can't happen inside that callback
 * (webpush.sendNotification is async), so it's scheduled with
 * `setImmediate`, which always runs after the synchronous transaction body
 * returns and better-sqlite3 has committed. If the surrounding transaction
 * later threw for an unrelated reason *after* this insert ran, a push could
 * in theory fire for a write that got rolled back; every call site writes
 * its notification as the last statement in its transaction, so in
 * practice that window doesn't occur. Documented limitation, not solved
 * generically. The realtime broadcast piggybacks on the same setImmediate
 * for the same "after commit" reason.
 */
import { eq } from "drizzle-orm";
import { notifications, sessions, circles, users, type CuatroDb, type Notification } from "@cuatro/db";
import { sendPushToUser } from "@/lib/push";
import { emitUserEvent } from "@/lib/realtime/broadcast";

export type NotificationInput =
  | { type: "game_filled"; payload: { sessionId: string } }
  | { type: "slot_promoted"; payload: { sessionId: string } }
  | { type: "dropout"; payload: { sessionId: string; userId: string } }
  | { type: "fourth_call"; payload: { sessionId: string; level: 1 | 2 } }
  | { type: "placement_complete"; payload: { matchId: string; rating: number | null } }
  | { type: "result_verified"; payload: { matchId: string; delta: number; explanation: string } }
  | { type: "result_disputed"; payload: { matchId: string } }
  | { type: "confirm_result"; payload: { matchId: string; sessionId: string } }
  | {
      type: "tab_nudge";
      payload: { circleId: string; tabEntryId: string; amountMinor: number; currency: string };
    };

export type NotificationType = NotificationInput["type"];
export type PayloadFor<T extends NotificationType> = Extract<NotificationInput, { type: T }>["payload"];

export type InsertNotificationInput = { userId: string } & NotificationInput;

export interface NotificationCopy {
  title: string;
  body: string;
}

function fmtDelta(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
}

/** Circle name + a human "Tue 20:00" style timestamp for a session, or null if the session's gone. */
function sessionContext(tx: CuatroDb, sessionId: string): { circleName: string; when: string } | null {
  const session = tx.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!session) return null;
  const circle = tx.select({ name: circles.name }).from(circles).where(eq(circles.id, session.circleId)).get();
  const when = session.startsAt.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { circleName: circle?.name ?? "your circle", when };
}

/**
 * Renders the title (what) + body (why) for a notification, per
 * design/HANDOFF.md screen 11. No branch ever emits "!" — padel results and
 * money nudges read as facts, not hype. Takes `tx` (rather than requiring
 * denormalised context in the payload) so both the writer
 * (insertNotification) and the reader (notifications.ts's list model) get
 * identical copy from the same stored payload.
 */
export function renderNotificationCopy(tx: CuatroDb, input: NotificationInput): NotificationCopy {
  switch (input.type) {
    case "game_filled": {
      const ctx = sessionContext(tx, input.payload.sessionId);
      return {
        title: "Your four is set",
        body: ctx ? `All slots filled for ${ctx.circleName}, ${ctx.when}.` : "All slots are filled for your next game.",
      };
    }
    case "slot_promoted": {
      const ctx = sessionContext(tx, input.payload.sessionId);
      return {
        title: "You're in",
        body: ctx
          ? `A slot opened up for ${ctx.circleName}, ${ctx.when} — you've been promoted from reserve.`
          : "A slot opened up and you've been promoted from reserve.",
      };
    }
    case "dropout": {
      const ctx = sessionContext(tx, input.payload.sessionId);
      const dropped = tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.payload.userId)).get();
      return {
        title: "A slot just opened",
        body: ctx
          ? `${dropped?.displayName ?? "Someone"} dropped out of ${ctx.circleName}, ${ctx.when}. No reserve to promote yet — consider a Fourth Call.`
          : "Someone dropped out and there's no reserve to promote yet.",
      };
    }
    case "fourth_call": {
      const ctx = sessionContext(tx, input.payload.sessionId);
      return input.payload.level === 1
        ? {
            title: "Your circle needs a fourth",
            body: ctx
              ? `${ctx.circleName} is short for ${ctx.when}. Tap in if you can make it.`
              : "A game in your circle is short a player.",
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
            ? `Placement Trio complete — you're rated ${rating.toFixed(2)}. Tap to see your Ledger.`
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
      const ctx = sessionContext(tx, input.payload.sessionId);
      return {
        title: "Confirm your result",
        body: ctx
          ? `The other team logged your score for ${ctx.circleName}, ${ctx.when}. Confirm so Glass can move for everyone.`
          : "The other team logged your score. Confirm so Glass can move for everyone.",
      };
    }
    case "tab_nudge": {
      const amount = (input.payload.amountMinor / 100).toFixed(2);
      return {
        title: "You've got a Tab nudge",
        body: `${input.payload.currency} ${amount} outstanding on the Tab. Settle when you can.`,
      };
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
      return `/matches/${input.payload.matchId}`;
    case "tab_nudge":
      return `/circles/${input.payload.circleId}`;
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
export function insertNotification(tx: CuatroDb, input: InsertNotificationInput): Notification {
  const { userId, ...rest } = input;
  const row = tx.insert(notifications).values({ userId, type: rest.type, payload: rest.payload }).returning().get();
  const copy = renderNotificationCopy(tx, rest);
  schedulePush(userId, copy, deepLinkFor(rest));
  scheduleRealtimeBroadcast(userId, row.id, rest.type);
  return row;
}
