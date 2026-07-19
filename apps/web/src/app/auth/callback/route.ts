import { NextResponse } from "next/server";

/**
 * Universal-link landing for Supabase's PKCE redirect (magic-link OTP and
 * OAuth both point `emailRedirectTo`/`redirectTo` here). Login itself now
 * happens in the native iOS app: when the app is installed, iOS opens it
 * directly from the universal link and this route is never hit. This is
 * only the BROWSER FALLBACK — no app installed, or the link was opened
 * somewhere that doesn't honour universal links.
 *
 * Deliberately does not touch the `code` query param at all: never reads,
 * exchanges, logs, or forwards it anywhere (not to Sentry, not to
 * PostHog). The client-side button below reads `location.search` +
 * `location.hash` directly in the browser and hands them to the app via
 * its custom scheme — the server never sees them a second time.
 */
export async function GET() {
  const scheme = process.env.CUATRO_URL_SCHEME || "cuatro-beta";
  const testflightUrl = process.env.CUATRO_TESTFLIGHT_URL || "";

  const secondaryAction = testflightUrl
    ? `<a class="btn btn-quiet" href="${escapeHtml(testflightUrl)}">Get the TestFlight beta</a>`
    : `<p class="quiet-note">Private beta opening soon.</p>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Cuatro to finish signing in</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <img class="mark" src="/landing/img/app-icon.png" width="52" height="52" alt="" aria-hidden="true">
  <h1>Open Cuatro to finish signing in</h1>
  <p>This secure link needs to open on the iPhone where you requested it.</p>
  <button type="button" id="open-app" class="btn btn-primary">Open Cuatro Beta</button>
  ${secondaryAction}
</main>
<script>
(function () {
  var btn = document.getElementById("open-app");
  btn.addEventListener("click", function () {
    var target = ${JSON.stringify(scheme)} + "://auth/callback" + window.location.search + window.location.hash;
    window.location.href = target;
  });
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
:root{color-scheme:dark;--ground:#131210;--surface:#1e1c19;--ink:#f5f2ec;--ink-muted:rgba(245,242,236,.6);--action:#ff5c3d;--hairline:rgba(245,242,236,.14)}
@media (prefers-color-scheme: light){:root{color-scheme:light;--ground:#faf8f4;--surface:#fff;--ink:#191713;--ink-muted:rgba(25,23,19,.6);--action:#ff4d2e;--hairline:rgba(25,23,19,.14)}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;background:var(--ground);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Archivo,sans-serif}
main{width:100%;max-width:380px;padding:32px 24px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:16px}
.mark{width:52px;height:52px;border-radius:16px;display:block;object-fit:cover;margin-bottom:4px}
h1{font-size:22px;font-weight:800;margin:0;letter-spacing:-.01em}
p{margin:0;font-size:14px;line-height:1.5;color:var(--ink-muted)}
.btn{width:100%;min-height:48px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;text-decoration:none;cursor:pointer;border:1px solid transparent;margin-top:8px}
.btn-primary{background:var(--action);color:#fff;border:none}
.btn-quiet{background:transparent;color:var(--ink);border:1px solid var(--hairline)}
.quiet-note{font-size:12.5px;margin-top:4px}
@media (prefers-reduced-motion: reduce){*{transition:none!important}}
`;
