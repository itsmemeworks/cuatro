/**
 * The landing page (public/landing/index.html) is written against the
 * canonical prod origin — its `og:url`/canonical-style absolute links say
 * padelcuatro.com. The same file is served at `/` on every environment
 * (staging, cuatro.fly.dev, local dev), where those links would silently
 * point a tester at PROD. This rewrites the served copy's absolute prod
 * links to whatever origin the request actually arrived on.
 *
 * The FILE stays canonical — the ../cuatro-site mirror serves it verbatim
 * on its own static app and must keep prod URLs, so the byte-identical
 * mirror rule (see cuatro-site/README) is untouched by this transform.
 */
export const CANONICAL_ORIGIN = "https://padelcuatro.com";

export function transformLandingHtml(html: string, origin: string): string {
  if (origin === CANONICAL_ORIGIN) return html;
  return html.replaceAll(CANONICAL_ORIGIN, origin);
}

/**
 * The page carries one `<!--TESTFLIGHT_CTA-->` marker per CTA slot (hero +
 * beta section). Resolved server-side from `CUATRO_TESTFLIGHT_URL` — present
 * or absent, this is the ONLY thing that decides which state ships, so
 * production can switch it on later purely via Fly secrets, no code change,
 * no redeploy of a different template.
 */
const PRIMARY_LG_LINK_CLASS =
  "btn btn-coral";

export function applyTestflightCta(html: string): string {
  const testflightUrl = process.env.CUATRO_TESTFLIGHT_URL;
  const cta = testflightUrl
    ? `<a class="${PRIMARY_LG_LINK_CLASS}" href="${escapeHtmlAttr(testflightUrl)}"><span>Get the TestFlight beta</span><span class="arrow" aria-hidden="true">&rarr;</span></a>`
    : `<span class="trust">private beta opening soon</span>`;
  return html.replaceAll("<!--TESTFLIGHT_CTA-->", cta);
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
