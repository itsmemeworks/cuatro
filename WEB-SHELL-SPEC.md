# WEB-SHELL-SPEC — CUATRO on every screen

**Status: Wave A SHIPPED (PR #22, merged 2026-07-11). Wave B SHIPPED (PR #24, 2026-07-11). Wave C BUILT 2026-07-11 (branch feat/web-shell-wave-c, all flows + issue #21 + the punch list; see the PR for the two deferrals: the ad-hoc match row in record step 1, and browser notifications which remain Wave D). Wave D remains — do not start it without Pete saying go.**

The design is done and authoritative: `design/CUATRO-Web-LATEST.dc.html` (25 interactive screens, desktop 1440 + tablet 1024, reviewed and punch-listed to zero on 2026-07-11). This spec turns it into build waves. Read `CLAUDE.md` first, then the DESIGN-AUDIT.md "Web/desktop design import" section, then this.

## The prize

No padel app has a desktop app. Playtomic, Padel Mates, MATCHi, Padium: phone-only. CUATRO's wedge user is the ORGANISER, and organisers live at desks. The two-context shell (home context for your week across circles, circle context for the clubhouse) is the whole product restated for a screen where you can see the game fill WHILE talking about it. Ship this and "the app your padel four runs on" runs on everything with a browser, PWA-installable on all of it.

## The two contexts (locked concept, do not reinterpret)

- **Home context** = you, across everything: Your week (7-day diary), Discover, The Tab (all circles), You.
- **Circle context** = one clubhouse: Feed, Chat, Members, Games, Tab (circle-scoped).
- Desktop 1440: icon rail (home + circle flags + bell) + context sidebar + content (max ~1000px) + optional docked chat pane in circle context.
- Tablet 1024: top bar, context pills, circle switcher dropdown, no rail.
- **Below ~900px: the existing phone experience, byte-for-byte untouched.** The 448px column stops being a root-layout constant and becomes the small-screen branch of a responsive shell. Zero phone regressions is the hardest requirement in this spec.

## Route mapping (shell re-architecture, not an IA rewrite)

| Design surface | Route today | Work |
|---|---|---|
| Your week | `/home` | new aggregate view at wide widths (7-day grid + needs-answer rail); phone keeps current home |
| Discover | partial (`/players`, discovery/open-door server modules) | compose existing server pieces into the public-games + open-circles surface; empty state = set your patch |
| The Tab (global) | `/tab` | wide two-column layout |
| You / Settings | `/profile`, `/profile/ledger` | add settings panel (patch, findable, hand/side, notification prefs, sign out) |
| Circle Feed/Chat/Members/Games/Tab | `/circles/[id]` (+ `/games/*`) | circle context = nested tabs under `/circles/[id]`; Games tab lists standing fixtures + one-offs |
| Record a result | `/matches/new` | 5-step overlay at wide widths; same server actions |
| Player profile | `/players/[userId]` | desktop layout + YOU TWO head-to-head |
| Notifications | `/notifications` | becomes a tray anchored to the bell at wide widths; page remains for phone |
| Guest link landing | `/fc/*`, `/join/*` | desktop-width layouts for claim → hold → in |

A scout pass maps each design screen to exact files before any wave starts; the table above is the shape, not the territory list.

## New product surface (beyond layout)

1. **Money opt-in + Booked-on signpost, hand/side fields** — already spec'd as [issue #21](https://github.com/itsmemeworks/cuatro/issues/21). Build it once, both form factors render it.
2. **⌘K quick switcher** — circles, people, games; `g c` / `g w` / `g t` shortcuts. Client-side over data the shell already has; no new API.
3. **Docked chat at 1440** — circle chat as a persistent right column; dock/undock toggle; collapses to the Chat tab at 1024. Reuses the existing realtime subscription; one subscription per circle regardless of dock state.
4. **Week aggregate** — one server query: my sessions + Fourth Calls + needs-answer flags across circles for the next 7 days. Feeds the grid, the tablet list, and (later) the phone home.
5. **Browser notifications** — quiet inline enable in the tray (uses the parked VAPID plumbing when Pete's keys land; until then the enable row is hidden, not stubbed).
6. **GLOSSARY canon** — add **Placement Trio** and **Glass poured** to `components/ui/info-term.tsx` and sweep existing copy ("3 verified matches" phrasing stays in the Ledger math lines; the branded terms front the UI). Single-owner file: lead applies.

## Design laws (enforced at review, same as the phone waves)

One coral action per PANEL (desktop restatement). Dashed coral circle = a space waiting for a person, nothing else. No em dashes, no exclamation marks, 10px type floor, facts in IBM Plex Mono. Unread = pill badge everywhere. Raw error codes never reach the UI (`lib/error-copy.ts`). Notifications through `server/notify.ts` only.

## Build waves (each gated, each shippable)

**Wave A — the shell.** Responsive root layout (rail/sidebar/topbar/phone branches), context detection, circle switcher, bell + tray shell, breakpoint plumbing. All existing pages render inside it unchanged. Gate: 430px screenshots identical to today; 1440/1024 shells match the design chrome.

**Wave B — the read surfaces.** Your week, Discover, wide Tab, You + settings, circle tabs (Feed/Members/Games lists), player profile. Mostly new views over existing queries + the week aggregate. Gate: screen-by-screen screenshots vs `CUATRO-Web-LATEST` at both widths.

**Wave C — the flows.** Record-a-result overlay, rotation pre-lock/locked/offer layouts, circle create + settings (visibility, join queue, standing game editor, money opt-ins per #21), Tab add-expense + settle handshake, guest landings. Gate: E2E-CHARTER additions driven in the real app.

**Wave C punch list (accumulated at the A/B gates, do these inside Wave C):**
/games/[sessionId] should resolve to CIRCLE context (needs data-aware context resolution — contract + shell change); app-wide money-format sweep to whole-pounds-when-clean (phone + wide together, re-cut the 430 baselines); RatingReveal must not spend its "seen" timer while display:none at wide widths (gate the timer on actual visibility inside the shared component's effect); lean countOpenBoardGamesNearPatch in discovery.ts for the shell badge (currently builds full Board cards per navigation); Members hand/side + Games "Booked on" tiles land with issue #21.

**Wave D — desktop-native.** ⌘K, docked chat, keyboard shortcuts, browser notifications (keys permitting). The USP garnish, last on purpose.

Parallel agents per the working agreement: strictly disjoint FILE territories, manifests to the session scratchpad, lead gates and ships. Single-owner files as listed in CLAUDE.md.

## Verification bar

- Every wave: `npm test` + `tsc --noEmit` + `npm run build` from root.
- Design claims: screenshots at **1440 AND 1024** vs `design/CUATRO-Web-LATEST.dc.html` (served on :8791), plus **430px unchanged** vs the phone prototype. Agents self-certifying without screenshots have been wrong before.
- Realtime claims (docked chat): a genuinely separate subscriber observing the event live.
- No deploy without Pete; staging flows through release merges as usual.

## Explicitly out of scope

Native apps, booking integration, payments execution (CUATRO never holds funds), any phone-IA changes, Cuatro Plus. The phone app is the reference implementation of the product; this spec makes it ubiquitous, not different.
