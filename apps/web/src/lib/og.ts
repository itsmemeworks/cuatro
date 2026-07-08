/**
 * URL helpers for CUATRO's dynamic OG images (design/HANDOFF.md's asset
 * list: "dynamic per-game OG image (faces + one dashed slot)" — the share
 * IS the ad, per Directions turn 8f).
 *
 * The routes themselves live under app/api/og/** (see
 * app/api/og/session/[id]/route.tsx and app/api/og/circle/[code]/route.tsx)
 * and render with `next/og`'s ImageResponse. Any page that wants one in its
 * `generateMetadata()` — including the session detail page, which this repo
 * currently splits to a different owner — just needs the URL, hence these
 * two one-line builders living somewhere both sides can import from.
 */
export function sessionOgImageUrl(sessionId: string): string {
  return `/api/og/session/${sessionId}`;
}

export function circleOgImageUrl(inviteCode: string): string {
  return `/api/og/circle/${inviteCode}`;
}
