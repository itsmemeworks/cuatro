import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Fix-wave F5 (GUEST-DOORS) structural pins — node env can't drive the DOM,
// so these hold the shapes that fixed QA2/QA6/QA8's outsider-surface findings
// (same approach as settings-sheet-close-on-save.test.ts).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("/join/[code] doors (QA2 findings 1+2)", () => {
  it("the logged-out join step offers existing users a sign-in path on step 1", () => {
    const source = read("components/entry/guest-circle-join-flow.tsx");
    expect(source).toContain("Already on CUATRO?");
    expect(source).toMatch(/\/login\?next=\$\{encodeURIComponent\(`\/join\/\$\{code\}`\)\}/);
  });

  it("the signed-in join page recognises an existing member instead of re-pitching the join", () => {
    const source = read("app/join/[code]/page.tsx");
    // The membership check must exist and gate a recognition render with a
    // way INTO the circle — not the "YOU'RE INVITED" pitch.
    expect(source).toContain("circleMembers");
    expect(source).toContain("YOU&apos;RE IN THIS CIRCLE");
    expect(source).toMatch(/href=\{`\/circles\/\$\{circle\.id\}`\}/);
  });
});

describe("/fc/[token] truth (QA6 top finding)", () => {
  it("the page derives a full state and never hands a full session the live claim CTA", () => {
    const source = read("app/fc/[token]/page.tsx");
    expect(source).toContain("resolveGuestFlowInitial");
    expect(source).toMatch(/isFull\s*=\s*summary\.confirmed\.length\s*>=\s*summary\.slots/);
    // Signed-in branch: the claim button renders only behind the not-full gate.
    expect(source).toMatch(/isFull \? \(/);
    // And the page re-checks on focus so an open tab can't go stale.
    expect(source).toContain("<RefreshOnFocus");
  });
});

describe("guest conversion landing (QA8 finding 4)", () => {
  it("the Fourth Call convert CTA targets the claimed game, not /home", () => {
    const source = read("components/entry/guest-claim-flow.tsx");
    expect(source).toMatch(/\/login\?next=\$\{encodeURIComponent\(`\/games\/\$\{sessionId\}`\)\}/);
    expect(source).not.toMatch(/\/login\?next=\$\{encodeURIComponent\("\/home"\)\}/);
  });

  it("the auth callback upgrades a converted guest's generic destination", () => {
    const source = read("app/auth/callback/route.ts");
    expect(source).toContain("isGenericConversionDestination(destination)");
    expect(source).toContain("resolveConvertedGuestLanding");
  });
});

describe("the Tab's phone surfaces (QA6 sheet + settle copy)", () => {
  it("the phone +Add sheet is save-then-close (CLAUDE.md #14; the wide dialog is the model)", () => {
    const sheet = read("components/tab/add-entry-sheet.tsx");
    expect(sheet).toMatch(/onSaved=\{\(\) => setOpen\(false\)\}/);
    const form = read("components/tab/add-entry-form.tsx");
    // onSaved must fire on the success path, before the refresh re-render.
    expect(form).toMatch(/onSaved\?\.\(\);\s*\n\s*router\.refresh\(\)/);
  });

  it("settle propose copy converges on the wide term at both widths", () => {
    const phone = read("components/tab/tab-entry-row.tsx");
    const wide = read("components/tab/tab-owe-row.tsx");
    expect(phone).toContain("`Settle ${formatMoneyWhole(entry.amountMinor, entry.currency)}`");
    expect(phone).not.toContain("`Mark as paid");
    expect(wide).toContain("`Settle ${amount}`");
  });
});
