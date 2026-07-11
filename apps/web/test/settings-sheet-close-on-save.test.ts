import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for the profile "Save home venue does nothing" bug.
//
// The bug was NOT server-side (updateDiscoverySettingsAction persists fine —
// see discovery-settings.test.ts). It was client-side and specific to React
// 19: a `<form action={fn}>` is auto-reset the moment its action resolves, and
// the Settings sheet stays mounted across a save. With uncontrolled fields
// that reset reverted the just-picked home venue back to its mount-time
// default ("No home venue") — it read as "the save didn't take", and a second
// Save then persisted that stale default, genuinely undoing the change.
//
// The fix routes every settings form through a handler that closes the sheet
// on success, so the fields UNMOUNT before the reset can fire and the next
// open remounts them from the freshly-revalidated server props. This is a
// runtime/DOM behaviour the node test env can't drive directly, so we pin the
// structural invariant that prevents the regression: neither settings form may
// hand a server action straight to `action=` (that leaves the sheet open
// across the reset), and the save path must close the sheet.
describe("SettingsSheet close-on-save (React 19 form-reset regression)", () => {
  const source = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../src/components/profile/settings-sheet.tsx"),
    "utf8",
  );

  it("does not pass a settings server action directly to a form action (the buggy shape)", () => {
    // The original bug: `action={updateDiscoverySettingsAction}` — a bare
    // server action, so the sheet stays open and React resets the fields.
    expect(source).not.toMatch(/action=\{\s*updateDiscoverySettingsAction\s*\}/);
    expect(source).not.toMatch(/action=\{\s*updateDisplayNameAction\s*\}/);
    expect(source).not.toMatch(/action=\{\s*updatePlayerAttrsAction\s*\}/);
  });

  it("closes the sheet after a save resolves so the fields unmount before the reset", () => {
    expect(source).toContain("setOpen(false)");
    // the save wrapper must await the action and only then close
    expect(source).toMatch(/await\s+action\(\s*formData\s*\)[\s\S]*setOpen\(false\)/);
  });

  it("wires every settings form through the save-then-close wrapper", () => {
    // Three forms: display name, discovery (findable + home venue), and the
    // ON COURT hand/side card (issue #21 — its fields are controlled, so it's
    // reset-proof either way, but it keeps the sheet's one consistent save UX).
    const wrapped = source.match(/action=\{\s*saveThenClose\(/g) ?? [];
    expect(wrapped.length).toBe(3);
  });
});
