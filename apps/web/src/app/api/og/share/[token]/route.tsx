import { ImageResponse } from "next/og";
import { resolveShareLink } from "@/server/share-link";

/**
 * Dynamic OG image for /s/[token]. Same no-custom-font, no-remote-image
 * posture as the court/circle/session OG routes. Never logs the token;
 * renders only the same public-safe fields the page itself shows.
 */
export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;

const LONDON_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await resolveShareLink(token);

  let heading = "CUATRO";
  let sub = "the social layer for padel";
  if (view?.kind === "game") {
    heading = view.circleName ?? "A Cuatro game";
    const d = new Date(view.startsAt);
    sub = `${view.venueName} · ${Number.isNaN(d.getTime()) ? view.startsAt : LONDON_FORMAT.format(d)}`;
  } else if (view?.kind === "circle") {
    heading = "A Cuatro Circle";
    sub = "shared with you";
  } else if (view?.kind === "profile") {
    heading = `Meet ${view.firstName}`;
    sub = "on Cuatro";
  } else if (view?.kind === "result") {
    heading = "A sealed Cuatro result";
    sub = "shared with you";
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#131210",
          padding: "64px",
          color: "#F5F2EC",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: "#FF5C3D", marginBottom: 24 }}>CUATRO</div>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>{heading}</div>
        <div style={{ display: "flex", fontSize: 26, color: "rgba(245,242,236,.6)", marginTop: 16 }}>{sub}</div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
}
