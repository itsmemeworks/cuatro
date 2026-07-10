import { render } from "@react-email/render";
import { createElement } from "react";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MagicLinkEmail } from "./magic-link.js";

/**
 * Renders the react-email components to the static HTML Supabase's Go
 * templating consumes. The {{ .ConfirmationURL }} placeholder must survive
 * verbatim, so we do NOT let the renderer touch it — react-email leaves it
 * intact (braces are not HTML-special). We also emit a browser-eyeball
 * preview with the placeholder swapped for a real URL.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const templateOut = resolve(repoRoot, "supabase/templates/magic-link.html");
const previewOut =
  "/private/tmp/claude-501/-Users-eemnauwl-Code-pigeon/85be4f70-2874-493a-8173-344dfe17e833/scratchpad/wave0-finisher/email-preview.html";

async function main() {
  const html = await render(createElement(MagicLinkEmail), { pretty: false });

  mkdirSync(dirname(templateOut), { recursive: true });
  writeFileSync(templateOut, html, "utf8");
  console.log(`wrote ${templateOut} (${html.length} bytes)`);

  const preview = html.replaceAll(
    "{{ .ConfirmationURL }}",
    "https://padelcuatro.com/home",
  );
  try {
    writeFileSync(previewOut, preview, "utf8");
    console.log(`wrote ${previewOut}`);
  } catch (err) {
    console.warn(`skipped preview (${(err as Error).message})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
