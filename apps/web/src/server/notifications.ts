/**
 * Read model for the Notifications Center (design/HANDOFF.md screen 11):
 * grouped by day, each row typed + worded via ./notify's
 * renderNotificationCopy/deepLinkFor — the exact same functions
 * insertNotification() used at write time, so a row here always matches
 * what its push notification said.
 */
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { notifications, type CuatroDb, type Notification } from "@cuatro/db";
import { deepLinkFor, renderNotificationCopy, type NotificationInput, type NotificationType } from "./notify";

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: Date;
}

export interface NotificationDayGroup {
  /** "Today" / "Yesterday" / a formatted date — see formatDayLabel. */
  label: string;
  notifications: NotificationView[];
}

const DEFAULT_LIST_LIMIT = 100;

function asNotificationInput(row: Pick<Notification, "type" | "payload">): NotificationInput {
  // The payload column is a free-form JSON blob at the schema level (see
  // packages/db/src/schema/notifications.ts) — every row here was written
  // by insertNotification(), so its (type, payload) pair is always a valid
  // NotificationInput member; this cast is where that invariant is assumed.
  return { type: row.type, payload: row.payload } as NotificationInput;
}

async function toView(row: Notification, tx: CuatroDb): Promise<NotificationView> {
  const input = asNotificationInput(row);
  const copy = await renderNotificationCopy(tx, input);
  return {
    id: row.id,
    type: input.type,
    title: copy.title,
    body: copy.body,
    href: deepLinkFor(input),
    read: row.readAt !== null,
    // createdAt is epoch-ms (Postgres bigint) now — surface a Date to the UI,
    // which is the shape every notification-list consumer already formats.
    createdAt: new Date(row.createdAt),
  };
}

function dayKey(date: Date): string {
  // The UK calendar day (not the UTC one): a 00:30 London notification must
  // group under "Today" for the person who just received it.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatDayLabel(date: Date, now: Date): string {
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const key = dayKey(date);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
}

/** Every notification for `userId`, newest first, grouped into day buckets ("Today", "Yesterday", then calendar dates). */
export async function listNotificationsForUser(
  db: CuatroDb,
  userId: string,
  now: Date = new Date(),
  limit = DEFAULT_LIST_LIMIT,
): Promise<NotificationDayGroup[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  const groups: NotificationDayGroup[] = [];
  let currentKey: string | null = null;
  for (const row of rows) {
    const createdAt = new Date(row.createdAt);
    const key = dayKey(createdAt);
    if (key !== currentKey) {
      groups.push({ label: formatDayLabel(createdAt, now), notifications: [] });
      currentKey = key;
    }
    groups[groups.length - 1]!.notifications.push(await toView(row, db));
  }
  return groups;
}

export async function getUnreadCount(db: CuatroDb, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Returns true if this call actually flipped an unread notification to read (false if already read, or not this user's). */
export async function markNotificationRead(db: CuatroDb, notificationId: string, userId: string, now: Date = new Date()): Promise<boolean> {
  const changed = await db
    .update(notifications)
    .set({ readAt: now.getTime() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return changed.length > 0;
}

/** Returns how many notifications this call flipped to read. */
export async function markAllNotificationsRead(db: CuatroDb, userId: string, now: Date = new Date()): Promise<number> {
  const changed = await db
    .update(notifications)
    .set({ readAt: now.getTime() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return changed.length;
}
