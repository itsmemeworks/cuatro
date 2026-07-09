import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { getDb } from "@/server/db";
import { circleAnchor, nearbyCircles } from "@/server/open-door";
import { resolvePatch } from "@/server/patch";
import { Card, Meta } from "@/components/ui";
import { InfoTerm } from "@/components/ui/info-term";
import { NearbyCircleCard } from "@/components/circles/nearby-circle-card";
import { circleColorFor } from "@/lib/design";
import { errorCopy } from "@/lib/error-copy";

export default async function CirclesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();
  const store = await getCirclesStore();
  const myCircles = user ? await store.listCirclesForUser(user.id) : [];
  const { error } = await searchParams;

  // "Circles near you": venue-anchored discovery of Circles the viewer can find
  // near their patch, across both visibility tiers — open Circles (knockable)
  // and invite-only Circles (visible, their open games take asks, joining is by
  // invite link). nearbyCircles orders them open-first then invite-only, each
  // nearest-first. Only active once the viewer has a resolved patch.
  const { db } = await getDb();
  const patch = user ? await resolvePatch(db, user.id) : null;
  const nearby = user && patch ? await nearbyCircles(db, user.id) : [];

  // Each Circle's home court (its derived anchor venue) for the row subtitle —
  // display only, name never coordinates. Null Circles simply omit the line.
  const anchorNameByCircle = new Map<string, string>();
  for (const c of myCircles) {
    const anchor = await circleAnchor(db, c.id);
    if (anchor) anchorNameByCircle.set(c.id, anchor.venueName);
  }

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-cu-title text-ink">Circles</h1>
        <Link
          href="/circles/new"
          className="rounded-chip bg-action text-action-contrast font-extrabold text-[13px] px-4 py-2.5 transition-cu-state active:opacity-80"
        >
          + New
        </Link>
      </div>

      {error && (
        <Card className="bg-loss-tint">
          <p className="text-cu-body text-loss">{errorCopy(error)}</p>
        </Card>
      )}

      {myCircles.length === 0 ? (
        <Card className="flex flex-col gap-1">
          <p className="text-cu-card-title text-ink">No Circles yet</p>
          <p className="text-cu-body text-ink-muted">
            Every good four started with two people and a maybe. Join one with a link or QR code, or create your own.
            This is where your padel group&apos;s chat, history and Standing Games live.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {myCircles.map((c) => {
            const colour = c.colour ?? circleColorFor(c.id);
            return (
              <Link key={c.id} href={`/circles/${c.id}`} className="block">
                <Card className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-card flex items-center justify-center text-xl shrink-0"
                    style={{ background: colour }}
                    aria-hidden
                  >
                    <span className="text-white font-extrabold text-base">
                      {c.emblem ?? c.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-cu-card-title text-ink truncate">{c.name}</p>
                    <Meta as="p" className="mt-0.5">
                      {c.memberCount} member{c.memberCount === 1 ? "" : "s"} ·{" "}
                      {c.myRole === "organiser" ? "Organiser" : "Member"}
                    </Meta>
                    {anchorNameByCircle.has(c.id) && (
                      <Meta as="p" className="mt-0.5 truncate">
                        {anchorNameByCircle.get(c.id)}
                      </Meta>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {user && (
        <section className="flex flex-col gap-3">
          <h2 className="text-cu-card-title text-ink">
            Circles near you{" "}
            <InfoTerm term="openDoor" label="Open Door" className="text-cu-meta font-normal align-middle" />
          </h2>
          {!patch ? (
            <Card>
              <p className="text-cu-body text-ink-muted">
                Set a home club or patch in{" "}
                <Link href="/profile" className="font-bold text-action-strong">
                  profile settings
                </Link>{" "}
                and we&apos;ll show Circles near you that welcome new players.
              </p>
            </Card>
          ) : nearby.length === 0 ? (
            <Card>
              <p className="text-cu-body text-ink-muted">
                No Circles near your patch yet. As groups nearby open up or post games, they show up here.
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {nearby.map((c) => (
                <NearbyCircleCard key={c.circleId} data={c} />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
