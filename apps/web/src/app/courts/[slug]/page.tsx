import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { getVenueBySlug } from "@/server/venues";
import { getCourtPageView, type CourtView } from "@/server/court-page";
import { VenueMapCard } from "@/components/games/venue-map-card";
import { Meta } from "@/components/ui";
import {
  BookingTile,
  CopyLinkRow,
  FixFactRow,
  OpenGames,
  TrustChip,
  WhoPlaysHere,
} from "@/components/atlas/venue-sheet";

/**
 * THE ATLAS court page: one venue, one page, shareable, works logged out.
 * Same content as the venue sheet at page scale (design "Atlas · Court page")
 * plus a static, postcode-rough map preview. No owner, no reviews, no device
 * location — the page is a projection of the community's own facts.
 */

/** The request's own origin (world-ready: never hardcode a domain). Mirrors lib/safe-redirect. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "http://localhost:3000";
  const forwardedProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = forwardedProto || (isLocal ? "http" : "https");
  return `${proto}://${host}`;
}

/** Resolve a slug to its venue + full court view in one pass (null if unknown). */
async function loadCourt(slug: string): Promise<{ court: CourtView; address: string | null } | null> {
  const { db } = await getDb();
  const venue = await getVenueBySlug(db, slug);
  if (!venue) return null;
  const court = await getCourtPageView(db, venue.id);
  if (!court) return null;
  return { court, address: venue.address };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadCourt(slug);
  if (!loaded) {
    return { title: "Court not found · CUATRO", description: "This court link is invalid or has moved." };
  }
  const { court } = loaded;

  const origin = await requestOrigin();
  const url = `${origin}/courts/${court.slug}`;
  const title = `${court.name} · CUATRO`;
  const description = `${court.factsLine}. ${court.homeLine}. See who plays here and any open games on the Atlas.`;
  const image = `${origin}/api/og/court/${court.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function CourtPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await loadCourt(slug);
  if (!loaded) notFound();
  const { court, address } = loaded;

  const origin = await requestOrigin();

  return (
    <main className="mx-auto w-full px-5 py-8 min-[900px]:max-w-[900px] min-[900px]:px-8 min-[900px]:py-14">
      <Link
        href="/discover"
        className="inline-flex items-center gap-1.5 rounded-chip border border-ink-hairline-2 px-3.5 py-2 text-[11.5px] font-bold text-ink transition-cu-state hover:bg-ink-hairline-1"
      >
        ← the Atlas
      </Link>

      <div className="mt-4 flex flex-wrap items-end gap-3.5">
        <div className="min-w-[240px] flex-1">
          <h1 className="text-[30px] font-extrabold leading-[1.05] tracking-[-0.01em] text-ink">{court.name}</h1>
          <p className="mt-2 font-mono text-[11px] text-ink-muted">{court.factsLine}</p>
        </div>
        <div className="w-full min-[900px]:w-auto">
          <CopyLinkRow slug={court.slug} origin={origin} />
        </div>
      </div>

      <div className="mt-3">
        <TrustChip homeLine={court.homeLine} showTrustLine />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-4 min-[900px]:grid-cols-[1.25fr_.75fr]">
        {/* Left column: who plays here + open games */}
        <div className="flex flex-col gap-3.5">
          <div className="rounded-card border border-ink-hairline-1 bg-surface p-4">
            <WhoPlaysHere circles={court.circles} />
          </div>
          {court.openGames.length > 0 && (
            <div className="rounded-card border border-ink-hairline-1 bg-surface p-4">
              <OpenGames games={court.openGames} />
            </div>
          )}
        </div>

        {/* Right column: map preview + booking + fix-a-fact + provenance */}
        <div className="flex flex-col gap-3.5">
          <div>
            <VenueMapCard venueName={court.name} venueAddress={address} pinLocationAction={null} />
            <Meta as="p" className="mt-1.5 text-center">
              position is postcode-rough
            </Meta>
          </div>
          {court.booking && <BookingTile booking={court.booking} variant="page" />}
          <div className="rounded-card border border-ink-hairline-1 bg-surface px-4 py-3.5">
            <p className="text-[12px] font-bold text-ink">Something off?</p>
            <Meta as="p" className="mt-0.5">
              facts are community filled, all of them optional
            </Meta>
            <FixFactRow className="mt-2.5" />
          </div>
          <Meta as="p" className="text-center">
            added by the community · verified by players calling it home
          </Meta>
        </div>
      </div>
    </main>
  );
}
