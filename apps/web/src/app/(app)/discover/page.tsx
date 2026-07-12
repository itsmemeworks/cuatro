import Link from "next/link";
import { eq } from "drizzle-orm";
import { users, venues } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { getDiscoverView } from "@/server/discover-page";
import { DEFAULT_RADIUS_KM, GLASS_BAND } from "@/lib/geo";
import { Card, Meta } from "@/components/ui";
import { InfoTerm } from "@/components/ui/info-term";
import { DiscoverGameCard } from "@/components/discover/discover-game-card";
import { DiscoverCircleCard } from "@/components/discover/discover-circle-card";
import { StartCircleCard } from "@/components/discover/start-circle-card";
import { DiscoverModeLayout } from "@/components/discover/discover-map-mode";
import { AddACourt } from "@/components/atlas/add-a-court";
import { PatchChip } from "@/components/atlas/patch-chip";

export const metadata = { title: "Discover · CUATRO" };

/** Section eyebrow — Archivo, uppercase, wide-tracked, muted (design's section labels). */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink-muted">{children}</h2>
  );
}

/** The two header filter chips. Visually faithful, functionally STATIC this wave (WEB-SHELL-SPEC): they read the real query defaults (the viewer's ±band, DEFAULT_RADIUS_KM) but don't yet re-filter. */
function FilterChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-chip border border-ink-hairline-2 px-4 py-2 text-[12px] font-bold text-ink whitespace-nowrap">
      {children}
    </span>
  );
}

export default async function DiscoverPage() {
  const user = await getSessionUser();
  if (!user) return null; // the (app) layout redirects unauthenticated users to /login

  const { db } = await getDb();
  const [row] = await db
    .select({ rating: users.rating, homeVenueId: users.homeVenueId })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const viewerRating = row?.rating ?? null;

  let patchAreaLabel: string | null = null;
  if (row?.homeVenueId) {
    const [v] = await db.select({ name: venues.name }).from(venues).where(eq(venues.id, row.homeVenueId)).limit(1);
    patchAreaLabel = v?.name ?? null;
  }

  const view = await getDiscoverView(db, user.id, { viewerRating, patchAreaLabel });

  // ---- No-patch empty state (discovery isn't active until a patch resolves) ----
  // List mode keeps the shipped set-your-patch prompt; Map mode shows the
  // country view (clusters only, no people) from view.atlas.
  if (!view.hasPatch) {
    const setPatchCard = (
      <Card className="mt-2 mx-auto max-w-[520px] flex flex-col items-center text-center gap-3 py-7 min-[1200px]:mt-0">
        <span
          aria-hidden
          className="flex items-center justify-center bg-action text-action-contrast font-extrabold"
          style={{ width: 52, height: 52, borderRadius: "50% 50% 50% 4px", transform: "rotate(-45deg)", boxShadow: "0 6px 20px rgba(255,92,61,.35)" }}
        >
          <span style={{ transform: "rotate(45deg)" }} className="text-[19px]">
            P
          </span>
        </span>
        <p className="text-[21px] font-extrabold text-ink mt-2">Set your patch first</p>
        <p className="text-cu-body text-ink-muted max-w-[360px]">
          pick where you play, we&apos;ll show you games around it. Never GPS
        </p>
        <Link
          href="/profile"
          className="mt-2 w-full rounded-button bg-action text-action-contrast font-extrabold text-[14px] text-center py-3.5 transition-cu-state hover:opacity-90 active:opacity-80"
        >
          Set my patch
        </Link>
        <Meta as="p" className="mt-1">
          findable is on by default. Flip it off in Settings any time
        </Meta>
      </Card>
    );

    return (
      <DiscoverModeLayout
        subtitle={null}
        chips={null}
        listSlot={setPatchCard}
        atlas={view.atlas}
        patchAreaLabel={view.patchAreaLabel}
        patchControl={view.patchControl}
      />
    );
  }

  const levelChip =
    viewerRating != null
      ? `Level ${(viewerRating - GLASS_BAND).toFixed(1)}–${(viewerRating + GLASS_BAND).toFixed(1)}`
      : "All levels";
  const nearLabel = patchAreaLabel ? `near ${patchAreaLabel}` : "near your patch";

  const subtitle = (
    <p className="text-cu-body text-ink-muted mt-1.5">
      public games and open Circles <InfoTerm term="patch" label={nearLabel} /> · your Glass travels with you
    </p>
  );

  const chips = (
    <>
      <FilterChip>{levelChip} ▾</FilterChip>
      <FilterChip>Within {DEFAULT_RADIUS_KM} km ▾</FilterChip>
      {/* The wide-header "+ Add a court" pill (design's Atlas add-a-court entry); the phone uses the list row below. */}
      <span className="hidden min-[900px]:inline-flex">
        <AddACourt variant="button" />
      </span>
    </>
  );

  const listSlot = (
    <div className="flex flex-col gap-6">
      {/* Desktop rail head: the full patch chip (home court over "your patch · size"). Rail-only; phone uses the header pill. */}
      <div className="hidden min-[1200px]:block">
        <PatchChip
          variant="full"
          patch={view.atlas.patch ? { lat: view.atlas.patch.lat, lng: view.atlas.patch.lng, radiusKm: view.atlas.patch.radiusKm } : null}
          size={view.patchControl.size}
          homeVenueId={view.patchControl.homeVenueId}
          homeVenueName={view.patchControl.homeVenueName}
          findable={view.patchControl.findable}
          venueOptions={view.patchControl.venueOptions}
        />
      </div>

      {/* Public games this week */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Public games this week</SectionLabel>
        {view.games.length === 0 ? (
          <Card>
            <p className="text-cu-body text-ink-muted">
              No public games near your patch this week. When a nearby Circle opens a spot, it shows up here with the
              level called honestly, so you can turn up as you are.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 min-[900px]:grid-cols-2 min-[1200px]:grid-cols-1 gap-3.5">
            {view.games.map((g) => (
              <DiscoverGameCard key={g.sessionId} game={g} />
            ))}
          </div>
        )}
      </section>

      {/* Circles open to join */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Circles open to join</SectionLabel>
        <div className="grid grid-cols-1 min-[680px]:grid-cols-2 min-[1200px]:grid-cols-1 gap-3.5">
          {view.openCircles.map((c) => (
            <DiscoverCircleCard key={c.circleId} data={c} />
          ))}
          <StartCircleCard />
        </div>
        <p className="mt-1 text-center text-cu-meta font-mono text-ink-muted">
          public means the link is open. Your Glass and show-up rate travel with you, both ways
        </p>
      </section>

      {/* The Atlas "Add a court" row (solid outline, never dashed coral — a court is not a person). */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Missing a court?</SectionLabel>
        <AddACourt variant="row" />
      </section>
    </div>
  );

  return (
    <DiscoverModeLayout
      subtitle={subtitle}
      chips={chips}
      listSlot={listSlot}
      atlas={view.atlas}
      patchAreaLabel={view.patchAreaLabel}
      patchControl={view.patchControl}
    />
  );
}
