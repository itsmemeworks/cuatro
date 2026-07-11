# Design Audit — app vs CUATRO-Prototype-LATEST.dc.html
*Audited personally in Chrome, 2026-07-09, signed in as seeded user via magic link. Reference screenshots: prototype walked screen-by-screen at localhost:8791.*

## P0 — THE global defect
**G1. No phone-frame constraint.** Every screen renders unconstrained full-width (audited at 1382px): nav items spread ~700px apart, cards stretch 1350px+, buttons become bars. The design is a phone experience. Fix once, globally: the app shell (content + bottom nav + headers) constrained to a centered ~448px column on the ground background at all viewport sizes. This single fix transforms every screen and is almost certainly the "nowhere near the design" reaction.

## P1 — structural per-screen (vs prototype reference)
**Landing/Login**
- L1. Landing shows lone "Get started" CTA; prototype welcome = the auth screen itself (Apple/Google/magic-link buttons directly). Merge: / renders the full onboarding welcome (with ambient court + wordmark lockup per prototype), /login redirects there.
- L2. "Got a game link from a mate?" card: copy must match prototype verbatim + "Try it →" affordance.
- L3. Wordmark lockup: big Archivo-900 with coral dot above-left (see prototype), positioned in the phone column — not pinned to viewport corner.

**Home (Games tab)**
- H1. Needs-answer card anatomy: add "View game →" top-right; avatar trio + "Kav & Mags are in — 2 spots to fill" line; I'm in / Can't as inline pair (coral ~2/3 + quiet ~1/3), not stacked full-width monsters.
- H2. Header: user avatar photo (top-right, links /profile) per prototype; bell restyled as quiet stroke icon (ink-muted + unread dot), not emoji-gold.
- H3. Confirmed-game rows: day/time left column mono, "You're in ✓" green pill right — close, tighten to prototype spacing.
- H4. Drop the "YOUR CIRCLES" section from Home (Circle tab owns that); keep needs-attention + games; "Manage" link restyle quiet.

**Nav (all screens)**
- N1. "You" item = avatar photo disc when available (guest/selfie avatars now exist; fallback initials).
- N2. Circle item unread-chat dot (needs unread tracking — see F3).
- N3. Verify icon SVGs against prototype (Circle icon questionable), sizes/spacing per anatomy (icons 21px, labels 9.5px, bar 18×3).

**Circle tab**
- C1. Feed must NOT embed the giant SessionCard (dashed-slot grid + full-width I'm in) — prototype Feed has only the compact pinned bar. SessionCard belongs on the session page.
- C2. Result posts: single-card layout per prototype — header row "Kav & Tom **beat** Sam & Mags / last Tuesday · confirmed ✓" with avatar pair, big centered score "6–3 6–4", mono delta line "Kav +0.04 → 4.91  Sam −0.03 → 4.62" (green/red), footer chips 👏N 💬N + "rematch?" right. No three-column sprawl.
- C3. Header: add "· N games · est. YYYY" + stacked member avatars right.
- C4. Chat segment shows unread count "Chat ·2" (needs F3).
- C5. Placement-reveal feed post type: "P finished her Placement Trio — Glass revealed: 4.15 / 3 verified games · confidence 41%" + respect chip (needs F2).
- C6. Members rows: right column = big rating + "conf NN%" mono beneath (app has this via formatGlass — verify against prototype density), "W3 this month" in the reliability line where data allows.

**The Tab**
- T1. Balances FIRST; "Add to the Tab" demoted to a compact affordance (button → sheet/inline expand), not a giant open form at top.
- T2. Balance rows per prototype: avatar + "Kav owes you / Tuesday's court split" + mono £8 + Nudge 👋 / coral Settle £N buttons right-aligned in-row. Only rows involving YOU + "All square ✓" rows for settled pairs; drop third-party pair rows from the balances section.
- T3. Nudge explainer strip: subtle tinted card (streak tint), exact copy w/ italic quote.
- T4. Activity rows: mono grammar "Tue 14 · court £32 · split 4 ways | £8 each" / "Mon 7 · Tom settled up ✓".
- T5. Footer "the Tab never charges fees — it just keeps score" (verify present below fold).

**Profile / Ledger**
- P1. Profile header: avatar photo left of name; chips row (✓ Shows up · 97% green tint, N Circles).
- P2. GLASS card: "GLASS" label + "▲ +0.11 this season" green mono top-right; hero number with mini bar-sparkline immediately right; confidence label/bar/percent row; "based on N verified games · sharpens every time you play".
- P3. "Last three" = three compact chips (W 6–2, L 4–6 style), not full-width bands.
- P4. Display-name edit + logout: demote to a quiet "Edit" affordance / settings sheet, not open forms on the profile.
- P5. Ledger rows: tighten to prototype (result bold + opponents muted inline, coral left-bar explanation block with mono factors line, balance row right-mono) — structure exists, density/width off (fixed largely by G1).

**Standing Game / session page**
- S1. Missing venue/map block: stylised map preview card (court-lines/roads placeholder + coral pin), venue name + address line (mono) + Copy, Google Maps / Apple Maps buttons, dashed "📍 Pin location to the Lot's chat" row (posts location into circle chat).
- S2. Missing cost row: "£32 court · £8 each · goes on the Tab | 60 min" (needs F4; "goes on the Tab" links/creates the split when session played).
- S3. Slot rows per prototype: avatar + name (+ "(you)") + status chip right ("In ✓" green tint / "Not answered" quiet); "2 SPOTS OPEN" mono coral badge in the This week header; dashed "4" disc + "Open — send a Fourth Call" + "Find a 4th →" row.
- S4. Reserve queue block: position number + avatar + name + "auto-promotes ✓" + explainer line mono.
- S5. Bottom: bone "Log last night's result" full-width (post-game state).

**Fourth Call send**
- FC1. Match prototype: kicker "FOURTH CALL · ORGANISER", title "Find a fourth / for Tue 8pm", mono subtitle "widening rings — closest people first, strangers never"; ONE card with numbered rings 1/2/3 (title + mono status each, Copy chip on ring 3); coral "Send the call"; mono footer "auto-escalates at 18:00 if the Circle is quiet". App has the pieces — tighten layout/copy to this exactly.

**Result entry**
- R1. Match prototype: title "How did it go?", one card: team rows (avatar pair + names, score right in Archivo-800 "7–5 · 6–4"), opponent row with "avg 4.87" mono, green encouragement pill INSIDE card; bone "Send to both teams"; mono footer "Glass moves only when both teams confirm — no referee, no disputes desk."

## F — feature gaps needed by the above (schema)
- F1. 💬 comments on result posts: match_comments table (match_id, user_id, body, created_at) + count on feed post + tap-through minimal thread (sheet) + realtime emit + notification (what/why rules).
- F2. Placement-reveal feed events: derivable from rating_events (placement completion) — feed read model union of results + reveals.
- F3. Chat unread: circle_members.last_read_at; unread count = messages newer than it (excluding own); drives "Chat ·N" segment + nav Circle dot; mark-read on chat view.
- F4. Standing game cost: standing_games.cost_minor + currency (organiser sets); per-head share display; "goes on the Tab" → one-tap create tab entries for the played session's slot-holders (payer = organiser default).
- F5. venues.address (text) for the map block + maps deep links (Google/Apple URL schemes from name+address).

## Verification bar for the fix wave
Every fix agent MUST verify at 430px-wide viewport rendering (screenshot or DOM-measured) before reporting; final acceptance is my own Chrome re-audit against the prototype, screen by screen.

---

# Web/desktop design import — 2026-07-11

**`design/CUATRO-Web-LATEST.dc.html` is now the authoritative DESKTOP + TABLET design** (imported from claude.ai/design project root file "CUATRO Web v2.dc.html"; avatars in `design/avatars/`, needs `support.js` beside it, serve `design/` on :8791 as usual). The phone prototype remains authoritative below ~900px.

Delta vs the phone prototype (what the web design ADDS, all Pete-reviewed and punch-listed to zero):
- Two-context shell: home context (Your week / Discover / The Tab / You) vs circle context (Feed / Chat / Members / Games / Tab). Desktop 1440 = rail + sidebar; tablet 1024 = top bar with circle dropdown; below ~900 = phone layout. Breakpoint note is in the file chrome.
- 25 interactive screens incl. NEW surfaces not in the phone prototype: record-a-result 5-step flow (roster seated by side, guest add, Glass prediction, pending seal + opposing confirm), rotation game pre-lock/locked (THE FOUR / THE BENCH / consent offer cascade), circle Games list (multi standing games + one-offs), circle settings (visibility tiers, join-request queue, standing game editor, money opt-ins), notifications tray + bell, ⌘K quick switcher, docked chat pane at 1440, player profile w/ public Ledger + YOU TWO, guest link landing (claim → hold → in), empty states (week/discover/feed), home settings (patch, findable, hand/side, notification prefs).
- Money opt-in model per the 2026-07-11 decision (Booked-on signpost XOR Tab cost, silence default) and hand/side profile fields — matches GitHub issue #21.
- New canon vocabulary used throughout: **Placement Trio**, **Glass poured** (+ "watch the pour"). Adopt in GLOSSARY when implementing.
- Design laws restated in a comment at the top of the file, incl. the desktop restatement: **one coral action per PANEL**.

Implementation spec: `WEB-SHELL-SPEC.md`. Verification bar for the web wave: screenshots at 1440 AND 1024 vs this file, plus 430px unchanged vs the phone prototype.
