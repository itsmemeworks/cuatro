import { getSessionUser } from "@/lib/session";
import { getGamesClient } from "@/server/games-db";
import { listNotificationsForUser } from "@/server/notifications";
import { NotificationRow } from "@/components/notifications/NotificationRow";
import { MarkAllReadButton } from "@/components/notifications/MarkAllReadButton";
import { Card } from "@/components/ui";

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) return null; // the (app) layout already redirects unauthenticated users to /login

  const { db } = await getGamesClient();
  const groups = await listNotificationsForUser(db, user.id);
  const hasUnread = groups.some((g) => g.notifications.some((n) => !n.read));

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-cu-title">Notifications</h1>
        {hasUnread && <MarkAllReadButton />}
      </div>

      {groups.length === 0 ? (
        <Card className="flex flex-col gap-1">
          <p className="text-cu-card-title">Nothing here yet</p>
          <p className="text-cu-body text-ink-muted">
            No games to fill, no scores to settle. This is where RSVP openings, Fourth Calls, and Glass movement show up.
          </p>
        </Card>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h2 className="text-cu-meta uppercase tracking-wide text-ink-muted">{group.label}</h2>
            <div className="flex flex-col gap-1.5">
              {group.notifications.map((n) => (
                <NotificationRow key={n.id} notification={n} />
              ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
