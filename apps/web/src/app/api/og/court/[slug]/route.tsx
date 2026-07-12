import { ImageResponse } from "next/og";
import { getDb } from "@/server/db";
import { getVenueBySlug } from "@/server/venues";
import { getCourtPageView } from "@/server/court-page";

/**
 * Dynamic OG image for a court page (app/courts/[slug]). Same no-custom-font,
 * no-remote-image posture as the circle/session OG routes — see
 * app/api/og/session/[id]/route.tsx for why (bold system sans, no Google Fonts
 * round trip, no <img> of remote/uploaded URLs into the constrained renderer).
 */
export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { db } = await getDb();
  const venue = await getVenueBySlug(db, slug);
  const court = venue ? await getCourtPageView(db, venue.id) : null;

  const name = court?.name ?? "CUATRO";
  const factsLine = court?.factsLine ?? "";
  const homeLine = court?.homeLine ?? "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#131210",
          padding: "64px",
          color: "#F5F2EC",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 12, height: 12, borderRadius: 999, background: "#FF5C3D", display: "flex" }} />
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: "#FF8A73" }}>THE ATLAS</div>
        </div>
        <div style={{ display: "flex", fontSize: 60, fontWeight: 800, marginTop: 28, lineHeight: 1.1, maxWidth: 1040 }}>
          {name}
        </div>
        {factsLine && (
          <div style={{ display: "flex", fontSize: 26, marginTop: 22, color: "rgba(245,242,236,.62)", fontFamily: "monospace" }}>
            {factsLine}
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "auto" }}>
          {homeLine && (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 700,
                color: "#4BC98B",
                background: "rgba(75,201,139,.13)",
                borderRadius: 999,
                padding: "10px 20px",
              }}
            >
              {homeLine}
            </div>
          )}
          <div style={{ display: "flex", fontSize: 22, color: "rgba(245,242,236,.5)" }}>cuatro · one court, one page</div>
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
