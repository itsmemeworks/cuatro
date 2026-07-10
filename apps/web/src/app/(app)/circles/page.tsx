import Link from "next/link";
import { eq } from "drizzle-orm";
import { circleMembers, users } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { getDb } from "@/server/db";
import { circleAnchor, nearbyCircles } from "@/server/open-door";
import { resolvePatch } from "@/server/patch";
import { Card, Meta, AvatarStack } from "@/components/ui";
import { InfoTerm } from "@/components/ui/info-term";
import { NearbyCircleCard } from "@/components/circles/nearby-circle-card";
import { CircleCardArt } from "@/components/circles/circle-header";
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

  // Per-Circle extras for the rich cards: the home-court anchor name (display
  // only, never coordinates) and a few member faces for the avatar stack. Both
  // are page-level composition over the shared read models — the list is a
  // viewer's own Circles, so this stays a handful of small reads.
  const anchorNameByCircle = new Map<string, string>();
  const facesByCircle = new Map<string, { src: string | null; name: string }[]>();
  for (const c of myCircles) {
    const anchor = await circleAnchor(db, c.id);
    if (anchor) anchorNameByCircle.set(c.id, anchor.venueName);
    const faces = await db
      .select({ avatarUrl: users.avatarUrl, displayName: users.displayName })
      .from(circleMembers)
      .innerJoin(users, eq(circleMembers.userId, users.id))
      .where(eq(circleMembers.circleId, c.id))
      .limit(5);
    facesByCircle.set(
      c.id,
      faces.map((f) => ({ src: f.avatarUrl, name: f.displayName })),
    );
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
            const faces = facesByCircle.get(c.id) ?? [];
            return (
              <Link key={c.id} href={`/circles/${c.id}`} className="block">
                <Card padded={false} className="overflow-hidden">
                  <CircleCardArt circleId={c.id} headerImage={c.headerImage} colour={colour} emblem={c.emblem} name={c.name} />
                  <div className="p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <Meta>
                        {c.memberCount} member{c.memberCount === 1 ? "" : "s"} ·{" "}
                        {c.myRole === "organiser" ? "Organiser" : "Member"}
                      </Meta>
                      {faces.length > 0 && <AvatarStack people={faces} size="sm" max={5} />}
                    </div>
                    {anchorNameByCircle.has(c.id) && (
                      <Meta as="p" className="truncate">
                        Home court: {anchorNameByCircle.get(c.id)}
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
                <Link href="/profile" className="font-bold text-ink underline">
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
              {nearby.map((c, i) => (
                <NearbyCircleCard key={c.circleId} data={c} showGlassInfo={i === 0} />
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
