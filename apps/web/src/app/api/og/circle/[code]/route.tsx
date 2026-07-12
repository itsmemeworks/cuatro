import { ImageResponse } from "next/og";
import { getCirclesStore } from "@/server/circles";

/**
 * Dynamic OG image for a Circle invite link (app/join/[code] — the join
 * flow this repo actually has; see that page's generateMetadata). Same
 * no-custom-font, no-remote-image posture as the session OG route — see
 * app/api/og/session/[id]/route.tsx for why.
 */
export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const store = await getCirclesStore();
  const circle = await store.getCircleByInviteCode(code);

  const name = circle?.name ?? "CUATRO";
  const colour = circle?.colour ?? "#FF4D2E";
  // A Circle's own emblem is an emoji the organiser picked (Satori/next-og
  // fetches a dynamic font for whatever glyph is asked for, which works
  // fine for emoji); the fallback for a Circle with none, or an invite code
  // that doesn't resolve, sticks to the same first-letter-initial glyph
  // Avatar's own no-photo fallback uses (components/ui/avatar.tsx) — always
  // in the base font, no dynamic font fetch to fail.
  const emblem = circle?.emblem ?? name.slice(0, 1).toUpperCase();

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
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div
            style={{
              width: 104,
              height: 104,
              borderRadius: 28,
              background: colour,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 52,
              color: "#fff",
            }}
          >
            {emblem}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 4, color: "#FF8A73" }}>YOU&apos;RE INVITED</div>
            <div style={{ fontSize: 54, fontWeight: 800, marginTop: 10 }}>{name}</div>
          </div>
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 24, color: "rgba(245,242,236,.55)" }}>
          All the chat, history and Standing Games · cuatro.app
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
