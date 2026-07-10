import { ImageResponse } from "next/og";
import { getGamesClient } from "@/server/games-db";
import { getSessionSummary } from "@/server/games-service";

/**
 * Dynamic OG image for a game/session share link — the surface Fourth Call
 * escalation and invites point at (design/HANDOFF.md's asset list + turn
 * 8f: "faces + one dashed slot"). better-sqlite3 (behind getGamesClient) is
 * a native Node module, so this must run in the Node.js runtime, not edge.
 *
 * Faces render as initial-in-a-circle, matching Avatar's own no-photo
 * fallback (components/ui/avatar.tsx) — deliberately not `<img>`ing
 * randomuser.me/user-uploaded URLs into ImageResponse's constrained
 * renderer, which needs every remote image fetch to succeed synchronously
 * or the whole response fails.
 *
 * No custom font is fetched here (Archivo would need an arraybuffer fetched
 * per request) — bold system sans keeps this working offline/in CI rather
 * than depending on a Google Fonts round trip at request time.
 */
export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = await getGamesClient();
  // No logged-in viewer for a public share image — an id that can never
  // match a real user keeps viewerStatus resolving to null rather than
  // leaking anyone's specific RSVP state into a link anyone can open.
  const summary = await getSessionSummary(db, id, "__og_viewer__");

  if (!summary) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#131210",
            color: "#F5F2EC",
            fontSize: 40,
            fontWeight: 800,
            fontFamily: "sans-serif",
          }}
        >
          CUATRO
        </div>
      ),
      { width: WIDTH, height: HEIGHT },
    );
  }

  const faces = summary.confirmed.slice(0, 3);
  const openSlots = Math.max(0, summary.slots - summary.confirmed.length);
  const timeLabel = new Date(summary.session.startsAt).toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const place = summary.venue?.name ?? summary.circleName;

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
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 4, color: "#FF8A73" }}>FOURTH CALL</div>
        </div>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 800, marginTop: 28, lineHeight: 1.15, maxWidth: 1000 }}>
          {timeLabel} · {place}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 52 }}>
          {faces.map((p) => (
            <div
              key={p.userId}
              style={{
                width: 88,
                height: 88,
                borderRadius: 999,
                background: "#3E7BFA",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 34,
                fontWeight: 800,
                color: "#fff",
              }}
            >
              {p.displayName.slice(0, 1).toUpperCase()}
            </div>
          ))}
          {openSlots > 0 && (
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: 999,
                border: "4px dashed #FF5C3D",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 34,
                fontWeight: 800,
                color: "#FF7A5C",
              }}
            >
              4
            </div>
          )}
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "rgba(245,242,236,.5)" }}>
          {summary.circleName} · cuatro.app
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
