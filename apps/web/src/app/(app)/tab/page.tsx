import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { Card } from "@/components/ui";
import { CircleTabRedirect } from "@/components/circles/circle-tab-redirect";

/**
 * The Tab nav tab (prototype's "The Tab" screen — see
 * design/CUATRO-Prototype-LATEST.dc.html's `goTab`). `/circles/[id]/tab`
 * remains the canonical page; this route resolves "which Circle" the same
 * way the Circle tab does (see (app)/feed/page.tsx) — last viewed, or
 * first, or an empty state for a viewer with no Circles yet.
 */
export default async function TabTabPage() {
  const user = await getSessionUser();
  if (!user) return null; // (app) layout already redirects unauthenticated visitors

  const store = await getCirclesStore();
  const circles = await store.listCirclesForUser(user.id);

  if (circles.length === 0) {
    return (
      <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
        <h1 className="text-cu-title text-ink">The Tab</h1>
        <Card className="flex flex-col gap-3">
          <div>
            <p className="text-cu-card-title text-ink">You&apos;re not in a Circle yet</p>
            <p className="text-cu-body text-ink-muted mt-1">
              The Tab tracks who owes who within a Circle — join one with a link or QR code, or create your own to get started.
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

  return <CircleTabRedirect circleIds={circles.map((c) => c.id)} suffix="/tab" />;
}
