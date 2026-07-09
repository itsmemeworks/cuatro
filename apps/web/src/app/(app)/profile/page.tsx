import Link from "next/link";
import { eq, count, and, isNotNull, asc } from "drizzle-orm";
import { circleMembers, users, venues } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { resolvePatch } from "@/server/patch";
import { getMatchesStore, gamesTotals } from "@/server/matches-db";
import { GlassHero } from "@/components/glass/glass-hero";
import { ReliabilityBadge } from "@/components/glass/reliability-badge";
import { computeStreak, computeBestWin } from "@/components/glass/profile-stats";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { SettingsSheet, type VenueOption } from "@/components/profile/settings-sheet";
import { Card, Chip, Meta } from "@/components/ui";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) return null;

  const store = await getMatchesStore();
  const [glass, history, entries] = await Promise.all([
    store.getProfileGlassView(user.id),
    store.getMatchHistorySummary(user.id),
    store.getLedger(user.id), // newest-first — powers the sparkline, streak, best-win, and last-three chips below
  ]);

  const { db } = await getDb();
  const [circlesRow] = await db.select({ n: count() }).from(circleMembers).where(eq(circleMembers.userId, user.id));
  const circlesCount = circlesRow?.n ?? 0;

  // Discovery settings + patch status. Venue options for the home-venue picker
  // are every pinned venue the app knows (an unpinned venue can't anchor a
  // patch — see server/patch.ts), name-sorted.
  const [discoveryRow] = await db
    .select({ findable: users.findable, homeVenueId: users.homeVenueId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const venueOptions: VenueOption[] = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(isNotNull(venues.lat), isNotNull(venues.lng)))
    .orderBy(asc(venues.name));
  const patch = await resolvePatch(db, user.id);
  const homeVenueName = discoveryRow?.homeVenueId
    ? (venueOptions.find((v) => v.id === discoveryRow.homeVenueId)?.name ?? null)
    : null;
  const patchStatusLine = !discoveryRow?.findable
    ? "Not findable, nearby games can't see you."
    : patch
      ? patch.source === "home_venue" && homeVenueName
        ? `On The Board · home venue ${homeVenueName}`
        : patch.source === "inferred"
          ? "On The Board · placed by where you play"
          : "On The Board · placed by your chosen area"
      : "Set a home venue to appear on The Board.";

  const sparklineValues = [...entries].reverse().map((e) => e.ratingAfter);
  const deltaSinceFirst = entries.length > 0 ? entries.reduce((sum, e) => sum + e.delta, 0) : null;
  const streak = computeStreak(entries);
  const bestWin = computeBestWin(entries);

  const lastThree = await Promise.all(
    entries.slice(0, 3).map(async (e) => {
      const detail = await store.getMatchDetail(e.matchId, user.id);
      if (!detail || !detail.viewerTeam) return null;
      const { gamesWonA, gamesWonB } = gamesTotals(detail.match.score);
      const [yourGames, oppGames] = detail.viewerTeam === "A" ? [gamesWonA, gamesWonB] : [gamesWonB, gamesWonA];
      const won = e.delta >= 0;
      return { id: e.id, won, label: `${won ? "W" : "L"} ${yourGames}–${oppGames}` };
    }),
  );

  return (
    <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <ProfileAvatar name={user.displayName ?? user.email} avatarUrl={user.avatarUrl} />
        <div className="flex-1">
          <h1 className="text-cu-title text-ink">{user.displayName}</h1>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {glass && <ReliabilityBadge pct={glass.reliabilityPct} lateCancelCount={glass.lateCancelCount} />}
            <Chip>{circlesCount} {circlesCount === 1 ? "Circle" : "Circles"}</Chip>
          </div>
        </div>
      </div>

      {glass && (
        <GlassHero glass={glass} userId={user.id} sparklineValues={sparklineValues} deltaSinceFirst={deltaSinceFirst} />
      )}

      {glass && glass.status === "rated" && (
        <div className="flex gap-2">
          <Card className="flex-1 text-center">
            <p className="text-cu-card-title text-ink">
              {history.wins}–{history.losses}
            </p>
            <Meta className="mt-0.5 block">W–L</Meta>
          </Card>
          <Card className="flex-1 text-center">
            <p className="text-cu-card-title text-ink">{streak.kind ? `${streak.kind}${streak.count}` : "—"}</p>
            <Meta className="mt-0.5 block">streak</Meta>
          </Card>
          <Card className="flex-1 text-center">
            <p className="text-cu-card-title text-ink">{bestWin != null ? `vs ${bestWin.toFixed(2)}` : "—"}</p>
            <Meta className="mt-0.5 block">best win</Meta>
          </Card>
        </div>
      )}

      <Link href="/profile/ledger">
        <Card className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-cu-card-title text-ink">The Ledger</p>
            <p className="text-cu-secondary text-ink-muted mt-0.5">every movement of your Glass, explained</p>
          </div>
          <span className="text-cu-card-title font-bold text-action">→</span>
        </Card>
      </Link>

      {lastThree.some(Boolean) && (
        <div>
          <p className="text-cu-secondary font-extrabold text-ink-muted px-0.5">Last three</p>
          <div className="flex gap-2 mt-2">
            {lastThree.map(
              (r) =>
                r && (
                  <Chip key={r.id} tone={r.won ? "positive" : "negative"} className="flex-1 justify-center py-2.5 text-[12px]">
                    {r.label}
                  </Chip>
                ),
            )}
          </div>
        </div>
      )}

      <Meta as="p" className="text-center">
        {patchStatusLine}
      </Meta>

      <SettingsSheet
        displayName={user.displayName}
        email={user.email}
        findable={discoveryRow?.findable ?? true}
        homeVenueId={discoveryRow?.homeVenueId ?? null}
        venueOptions={venueOptions}
      />
    </main>
  );
}
