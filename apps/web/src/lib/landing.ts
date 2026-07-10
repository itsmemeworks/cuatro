import { QrCode, Ecc, qrToPath, qrViewBoxSize } from "@/lib/qr/svg";

/**
 * The landing page (public/landing/index.html) is written against the
 * canonical prod origin — its "Open CUATRO" buttons, the "Get it on your
 * phone" step copy and the QR code all say padelcuatro.com. The same file
 * is served at `/` on every environment (staging, cuatro.fly.dev, local
 * dev), where those links would silently bounce a tester into PROD. This
 * rewrites the served copy for the origin the request actually arrived on:
 * absolute links, the visible host in the step copy, and a freshly encoded
 * QR (the vendored zero-dep encoder, same as runtime join QRs).
 *
 * The FILE stays canonical — the ../cuatro-site mirror serves it verbatim
 * on its own static app and must keep prod URLs, so the byte-identical
 * mirror rule (see cuatro-site/README) is untouched by this transform.
 */
export const CANONICAL_ORIGIN = "https://padelcuatro.com";

export function transformLandingHtml(html: string, origin: string): string {
  if (origin === CANONICAL_ORIGIN) return html;
  const host = origin.replace(/^https?:\/\//, "");

  // Absolute links + og:url first; then the schemeless host in the step
  // copy and the QR aria-label ("Open padelcuatro.com/login").
  let out = html
    .replaceAll(CANONICAL_ORIGIN, origin)
    .replaceAll("padelcuatro.com/login", `${host}/login`);

  // Re-encode the QR for this origin's login URL. viewBox is swapped along
  // with the path because a longer host can bump the symbol to a larger
  // QR version.
  const qr = QrCode.encodeText(`${origin}/login`, Ecc.MEDIUM, -1);
  const dim = qrViewBoxSize(qr, 4);
  const d = qrToPath(qr, 4);
  out = out.replace(
    /(<svg[^>]*viewBox=")[^"]*("[^>]*aria-label="QR code linking to [^"]*"[^>]*>[\s\S]*?<path d=")[^"]*(")/,
    (_m, pre: string, mid: string, post: string) => `${pre}0 0 ${dim} ${dim}${mid}${d}${post}`,
  );
  return out;
}
