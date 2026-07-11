import Link from "next/link";
import { inArray } from "drizzle-orm";
import { users } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { getCirclesStore } from "@/server/circles";
import { getTabView } from "@/server/tab";
import { circleColorFor } from "@/lib/design";
import { Card } from "@/components/ui";
import { TabPhoneRedirect } from "@/components/tab/tab-phone-redirect";
import { TabAllCircles, type TabCircleCard, type TabGlobalNet } from "@/components/tab/tab-all-circles";
import type { TabOweRowData } from "@/components/tab/tab-owe-row";

/** GBP-first choice of the one currency a ±£ line shows — currencies never net against each other (CLAUDE.md #4); the biggest non-GBP stake wins when there's no GBP. Null when everything squares to zero. */
function chooseNet(byCurrency: Record<string, number>): TabGlobalNet | null {
  const nonZero = Object.entries(byCurrency).filter(([, minor]) => minor !== 0);
  if (nonZero.length === 0) return null;
  const [currency, minor] =
    nonZero.find(([c]) => c === "GBP") ?? [...nonZero].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]!;
  return { minor, currency };
}

/**
 * The Tab nav tab. Below 900px it stays the thin resolver it has always been —
 * redirect to the last-viewed Circle's canonical Tab (or an empty state when
 * the viewer has no Circle) — so the phone experience is byte-for-byte
 * unchanged. At 900px+ it becomes the wide home-context "all Circles" Tab
 * (design/CUATRO-Web-LATEST.dc.html), an aggregate over server/tab.ts's
 * getTabView across every Circle. CSS decides which face shows; the phone
 * redirect self-gates on the same breakpoint so it never fires over the wide
 * view (see components/tab/tab-phone-redirect.tsx).
 */
export default async function TabTabPage() {
  const user = await getSessionUser();
  if (!user) return null; // (app) layout already redirects unauthenticated visitors

  const store = await getCirclesStore();
  const circles = await store.listCirclesForUser(user.id);

  if (circles.length === 0) {
    // Phone: the original empty state, unchanged. Wide: the same message,
    // laid out for the desktop content column.
    // Issue #21: the Tab is opt-in, never required — games carry no money by
    // default, and this copy owns that identity even before the first Circle.
    const emptyCopy =
      "The Tab keeps score when someone fronts the court or a tin of balls. No fees, no chasing. It lives inside a Circle, so join one with a link or QR code, or create your own.";
    return (
      <>
        <main className="px-5 pt-8 pb-6 flex flex-col gap-6 min-[900px]:hidden">
          <h1 className="text-cu-title text-ink">The Tab</h1>
          <Card className="flex flex-col gap-3">
            <div>
              <p className="text-cu-card-title text-ink">You&apos;re not in a Circle yet</p>
              <p className="text-cu-body text-ink-muted mt-1">{emptyCopy}</p>
            </div>
            <Link
              href="/circles/new"
              className="rounded-button min-h-11 flex items-center justify-center text-[14px] font-extrabold bg-action text-action-contrast"
            >
              + Create a Circle
            </Link>
          </Card>
        </main>
        <div className="c4-wide hidden min-[900px]:block w-full max-w-[1000px] mx-auto px-[30px]">
          <h1 className="text-[29px] leading-none font-extrabold text-ink">The Tab</h1>
          <p className="mt-1.5 text-[12.5px] text-ink-muted">across all your Circles</p>
          <Card className="mt-[18px] flex flex-col gap-3 max-w-[480px]">
            <div>
              <p className="text-cu-card-title text-ink">You&apos;re not in a Circle yet</p>
              <p className="text-cu-body text-ink-muted mt-1">{emptyCopy}</p>
            </div>
            <Link
              href="/circles/new"
              className="rounded-button min-h-11 px-4 self-start flex items-center justify-center text-[14px] font-extrabold bg-action text-action-contrast transition-cu-state hover:opacity-90"
            >
              + Create a Circle
            </Link>
          </Card>
        </div>
      </>
    );
  }

  // --- wide aggregate (built server-side; the phone branch redirects past it) ---
  const { db } = await getDb();
  const views = await Promise.all(circles.map((c) => getTabView(db, c.id, user.id)));

  const globalByCurrency: Record<string, number> = {};
  const cards: TabCircleCard[] = [];
  const counterpartyIds = new Set<string>();

  circles.forEach((circle, i) => {
    const view = views[i];
    if (!view) return; // not a member (shouldn't happen for a listed circle) — skip

    for (const [currency, minor] of Object.entries(view.netPositionByCurrency)) {
      globalByCurrency[currency] = (globalByCurrency[currency] ?? 0) + minor;
    }

    const oweRows: TabOweRowData[] = view.activity
      .filter((e) => (e.payerUserId === user.id || e.debtorUserId === user.id) && e.status !== "settled")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((e) => ({
        id: e.id,
        payerUserId: e.payerUserId,
        payerName: e.payerName,
        debtorUserId: e.debtorUserId,
        debtorName: e.debtorName,
        amountMinor: e.amountMinor,
        currency: e.currency,
        status: e.status,
        pendingSettleBy: e.pendingSettleBy,
      }));

    for (const r of oweRows) counterpartyIds.add(r.payerUserId === user.id ? r.debtorUserId : r.payerUserId);

    const net = chooseNet(view.netPositionByCurrency);
    cards.push({
      id: circle.id,
      name: circle.name,
      flagLabel: circle.emblem ?? circle.name.slice(0, 2).toUpperCase(),
      flagColor: circle.colour ?? circleColorFor(circle.id),
      netMinor: net?.minor ?? null,
      netCurrency: net?.currency ?? null,
      oweRows,
      avatarByUserId: {},
    });
  });

  // One batched avatar lookup for every counterparty across every Circle.
  if (counterpartyIds.size > 0) {
    const rows = await db
      .select({ id: users.id, avatarUrl: users.avatarUrl })
      .from(users)
      .where(inArray(users.id, [...counterpartyIds]));
    const avatarById = new Map(rows.map((r) => [r.id, r.avatarUrl]));
    for (const card of cards) {
      for (const r of card.oweRows) {
        const cp = r.payerUserId === user.id ? r.debtorUserId : r.payerUserId;
        card.avatarByUserId[cp] = avatarById.get(cp) ?? null;
      }
    }
  }

  const globalNet = chooseNet(globalByCurrency);

  return (
    <>
      {/* Phone: redirect to the canonical Circle Tab, exactly as before. Self-gates at >= 900px. */}
      <TabPhoneRedirect circleIds={circles.map((c) => c.id)} />
      {/* Wide: the aggregate. display:none below 900 so the phone render is unchanged. */}
      <div className="c4-wide hidden min-[900px]:block w-full max-w-[1000px] mx-auto px-[30px]">
        <TabAllCircles viewerUserId={user.id} globalNet={globalNet} cards={cards} />
      </div>
    </>
  );
}
