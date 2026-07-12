import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * THE TIMEZONE REGRESSION GUARD (fix-wave F2, QA4/QA7/QA8).
 *
 * The Fly runtime is TZ=UTC. A `toLocaleString`/`Intl.DateTimeFormat` call
 * without an explicit `timeZone` renders raw UTC — an hour early for a UK
 * user in BST, and the wrong DAY for anything near midnight. That bug class
 * shipped repeatedly ("same game, two times on one screen"), so this test
 * makes it structurally impossible to reintroduce: it scans every source
 * file under src/ and FAILS on any date/time formatter call whose argument
 * list does not contain an explicit `timeZone`.
 *
 * How to make a new time render pass this test (in order of preference):
 *  1. Use lib/time.ts — every formatter there REQUIRES an IANA timezone.
 *     Session instants take the session's effective timezone
 *     (SessionSummary.timezone: venue's, else the Circle's); viewer-anchored
 *     instants with no venue/circle (notification rows) take DEFAULT_TZ.
 *  2. If a shape lib/time.ts doesn't cover, call Intl yourself WITH an
 *     explicit `timeZone` option (and consider adding the shape to lib/time).
 *  3. A genuinely timezone-free case (there are almost none — "date-only"
 *     is NOT one, see the midnight-crossing tests in time.test.ts) may be
 *     allowlisted below WITH a reason.
 *
 * The allowlist supports `pending` entries for violations owned by another
 * in-flight workstream: a pending entry tolerates the violation while it
 * exists and passes silently once fixed (delete it then). A non-pending
 * entry that no longer matches any violation FAILS the test — stale
 * allowlist lines get removed, not collected.
 */

const SRC_ROOT = fileURLToPath(new URL("../src", import.meta.url));

type AllowlistEntry = {
  /** Path relative to src/, forward slashes. */
  file: string;
  reason: string;
  /** True = owned by another in-flight fix (fix-wave manifest); tolerated while present, silently fine once fixed. Delete the entry when the fix lands. */
  pending?: boolean;
};

const ALLOWLIST: AllowlistEntry[] = [
  // (empty — the F1 fix-wave delegations landed; add entries only per the
  // rules in the header comment above)
];

/** Formatter call heads that render an instant using a timezone (implicitly the runtime's when no timeZone option is given). */
const CALL_HEAD = /(\.toLocale(?:Date|Time)?String|new\s+Intl\.DateTimeFormat)\s*\(/g;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listSourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

/** The full argument text of the call starting at `openParenEnd` (index just past the opening paren), via balanced-paren scan. */
function callArgs(source: string, openParenEnd: number): string {
  let depth = 1;
  let i = openParenEnd;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    i += 1;
  }
  return source.slice(openParenEnd, i - 1);
}

function findViolations(): { file: string; line: number; head: string }[] {
  const violations: { file: string; line: number; head: string }[] = [];
  for (const filePath of listSourceFiles(SRC_ROOT)) {
    const source = readFileSync(filePath, "utf8");
    const rel = relative(SRC_ROOT, filePath).split(sep).join("/");
    CALL_HEAD.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CALL_HEAD.exec(source))) {
      const args = callArgs(source, match.index + match[0].length);
      if (!/timeZone/.test(args)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push({ file: rel, line, head: match[1] });
      }
    }
  }
  return violations;
}

describe("timezone regression guard", () => {
  const violations = findViolations();
  const allowedFiles = new Set(ALLOWLIST.map((e) => e.file));

  it("every date/time formatter call in src/ passes an explicit timeZone (or routes through lib/time.ts)", () => {
    const unexplained = violations.filter((v) => !allowedFiles.has(v.file));
    const report = unexplained
      .map((v) => `  src/${v.file}:${v.line} — ${v.head}( … ) has no explicit timeZone`)
      .join("\n");
    expect(
      unexplained.length,
      `Raw-UTC formatter calls found (the QA4/QA7/QA8 hour-early class).\n` +
        `Use lib/time.ts (tz-required formatters) or pass an explicit timeZone:\n${report}\n`,
    ).toBe(0);
  });

  it("no stale allowlist entries (non-pending entries must still match a violation; delete fixed pending ones opportunistically)", () => {
    const violatingFiles = new Set(violations.map((v) => v.file));
    const stale = ALLOWLIST.filter((e) => !e.pending && !violatingFiles.has(e.file));
    expect(
      stale.map((e) => e.file),
      "These allowlist entries no longer match any violation — remove them from ALLOWLIST.",
    ).toEqual([]);
  });
});
