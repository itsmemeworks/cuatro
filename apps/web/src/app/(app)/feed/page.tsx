import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { Card } from "@/components/ui";
import { CircleTabRedirect } from "@/components/circles/circle-tab-redirect";

/**
 * The Circle nav tab (prototype's Feed / Chat / Members screens — see
 * design/CUATRO-Prototype-LATEST.dc.html's `goFeed`). `/circles/[id]`
 * remains the canonical page; this route just resolves "which Circle" —
 * the last one viewed (localStorage, via CircleTabRedirect), or the first
 * one, or an empty state for a viewer with no Circles yet.
 */
export default async function FeedTabPage() {
  const user = await getSessionUser();
  if (!user) return null; // (app) layout already redirects unauthenticated visitors

  const store = await getCirclesStore();
  const circles = await store.listCirclesForUser(user.id);

  if (circles.length === 0) {
    return (
      <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
        <h1 className="text-cu-title text-ink">Circles</h1>
        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-cu-card-title text-ink">You&apos;re not in a Circle yet</p>
            <p className="text-cu-body text-ink-muted mt-1">
              Join one with a link from a friend, or create your own to bring your padel group over from
              WhatsApp.
            </p>
          </div>
          <Link
            href="/circles/new"
            className="rounded-button min-h-11 flex items-center justify-center text-[14px] font-extrabold bg-action text-action-contrast"
          >
            + Create a Circle
          </Link>
        </Card>
      </main>
    );
  }

  return <CircleTabRedirect circleIds={circles.map((c) => c.id)} />;
}
