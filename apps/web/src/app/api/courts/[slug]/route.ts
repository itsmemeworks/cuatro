import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { getVenueBySlug } from "@/server/venues";
import { getCourtPageView } from "@/server/court-page";

/**
 * PUBLIC court view for a venue slug — the data the Discover venue sheet
 * (components/atlas/venue-sheet.tsx) fetches lazily on open. Public on purpose:
 * a court page is shareable and works logged-out, and getCourtPageView already
 * exposes only aggregate, viewer-independent facts (private Circles never in
 * it). An unknown slug 404s exactly like the page's notFound().
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db } = await getDb();

  const venue = await getVenueBySlug(db, slug);
  if (!venue) return NextResponse.json({ ok: false, error: "venue_not_found" }, { status: 404 });

  const court = await getCourtPageView(db, venue.id);
  if (!court) return NextResponse.json({ ok: false, error: "venue_not_found" }, { status: 404 });

  return NextResponse.json({ ok: true, court });
}
