# CUATRO v1 — Chrome E2E Charter

Bar set by Pete (2026-07-08): test **design accuracy**, **all functionality**, **multi-user flows**, and **realtime** — to 100% feature completion. Environment: local dev (Next.js on :3000 + local Supabase stack on 544xx, Mailpit for magic links). Final pass repeated against https://cuatro.fly.dev after deploy.

## A. Design accuracy (vs design/CUATRO-Prototype.dc.html + HANDOFF.md)
For every screen, side-by-side against the prototype:
- [ ] Tokens: ground/surface/ink hexes (dark primary), coral action, exactly ONE coral action per screen, ink alpha tiers
- [ ] Type: Archivo weights per role; ALL facts/metadata in IBM Plex Mono with tabular-nums; scale (56 hero → 10 meta floor); Glass always 2dp + confidence; Unrated = `?.??`
- [ ] Shape/space: radii (999/14/20/36), 4pt grid, card padding 16, touch targets ≥44px (RSVP/settle ≥48)
- [ ] Signature components: dashed coral slot everywhere a person is missing; avatar stacks (−10px overlap, 2px ring)
- [ ] Motion: RSVP coral→green morph + avatar spring; both-deltas seal (never one team first); rating reveal scramble on placement completion; toasts bone/bottom/2.1s; prefers-reduced-motion fallbacks
- [ ] Copy rules: what/why notifications, no exclamation marks, no shame mechanics, footers ("no fees · no ads · no dark patterns", Ledger append-only line, Tab never-charges line)
- [ ] Light theme + dark theme both correct; theme-color metas
- [ ] PWA: manifest, coral "4" icon, installability

## B. Functional flows (multi-user — minimum 3 distinct users via Mailpit magic links)
1. **Auth**: magic link (Mailpit capture) sign-in/out; ?next= deep link preservation; Google/Apple buttons show friendly "not switched on" message (providers disabled); user provisioning (display name from email, GB default)
2. **Circles**: create (colour/emblem), invite link copy, User B joins via link logged-out (login detour lands back on join), idempotent re-join, member list shows Glass/reliability/roles, outsider gets 404/403
3. **Chat**: A sends, B sees it live (no refresh) — realtime; reconnect catch-up (kill/restore network in tab)
4. **Standing Game**: organiser creates (Tue 20:00, venue, 4 slots); session auto-appears; non-organiser cannot create/edit
5. **RSVP**: window rules enforced; A/B/C in (slots fill in order), D queues as reserve; B drops → D auto-promoted live on A's open session page + notification; late-cancel counts against reliability, early doesn't
6. **Fourth Call**: L1 notifies non-RSVP'd circle members at T-48h; L2 escalation reaches extended-network user E (shared-circle/opponent-history, ±0.5 band); E claims via "I can play" without joining the circle; slot fills live everywhere
7. **Result + Glass**: A records 2v2 with sets; other team confirms → seal shows BOTH deltas; ratings move exactly once (double-confirm idempotent); dispute path blocks movement; retired match flagged; placement trio → rating reveal on 3rd verified match; Ledger rows explain every delta, factors expand, running values correct; Echo Damping visible on a repeat fixture (smaller delta, noted in explanation)
8. **The Tab**: add split entry (check penny-exact math, e.g. £32/3), balances net correctly, nudge once (second attempt blocked; debtor gets what/why notification), two-step settle (proposer ≠ confirmer), "All square ✓" collapse
9. **Notifications**: bell unread count updates live; center groups by day; deep links land on the right pages; mark-read works
10. **Home**: needs-attention (pending confirmations, fourth calls, placement nudge), week's games, circles list; empty states for a fresh user
11. **Session played transition**: record-result appears only after startsAt+duration

## C. Realtime matrix (two browser tabs/contexts side by side)
| Action (tab 1) | Must update live (tab 2) |
|---|---|
| Chat message | Circle chat thread |
| RSVP in/out | Session slots + circle pinned bar |
| Reserve promotion | Session page + promoted user's bell |
| Fourth call claim | Session slots + organiser's view |
| Result confirmed (seal) | Session page + all 4 users' bells + circle feed |
| Tab nudge/settle | Debtor's bell / circle tab page |

## C2. Wave C additions (web shell flows, 2026-07-11)
- [ ] Record-a-result 5-step overlay at 1440/1024: record → pending → opposing confirm → both-deltas seal; roster seats players by court side (drive/backhand markers), swaps free; 430 unchanged
- [ ] Rotation at wide: pre-lock availability + ranked list → locked THE FOUR / THE BENCH → post-lock drop fires consent offer → offeree accepts via receive takeover (regression guard: this page 500'd on Postgres via a SQLite `json_extract` — any Fourth Call invitee page render is the canary)
- [ ] Money opt-in XOR both directions through the real editor: booking set clears cost, cost set clears booking, both-in-one-payload rejected with visible error copy (edit form must SHOW the error, not save silently)
- [ ] Booked-on chip renders on game detail, games list, week grid, pinned feed card; tappable when URL present; booked-on games show ZERO cost/split chrome anywhere
- [ ] Guest link landing is responsive: /fc/[token] at 1440 shows the wide card + wordmark, 430 keeps phone anatomy; claim → hold → in works logged out at both
- [ ] Side hint never filters: organiser sets a hint; a wrong-sided, uninvited guest still completes claim via the public link
- [ ] Week grid cells navigate to their game; every server-action button shows a pending state (no silent clicks); money renders whole-pounds-when-clean everywhere (tab_nudge notification included)
- [ ] Profile hand/side: save → persist → public profile mono facts; RatingReveal does not spend its seen-timer while hidden at wide widths

## C3. Wave D additions (desktop-native, 2026-07-11)
- [ ] ⌘K/Ctrl+K opens the quick switcher from anywhere including a focused input; type-to-filter ranks circle > game > person; ↑↓/Enter navigates; Esc closes locally
- [ ] g c / g w / g t navigate with ~1s expiry and are SUPPRESSED while any input/textarea/contentEditable has focus (type "gt" in the chat composer: it must stay in the composer)
- [ ] Docked chat at 1440: message from a separate browser context lands live in the dock; dock/undock persists; undocked leaves unread counted, re-docking marks read
- [ ] ONE realtime channel per circle topic regardless of mounts (dock + tab + badge watcher + LiveRefresh) — assert at the socket level, not by behaviour
- [ ] Sidebar/topbar circle nav rows land on their sub-routes (chat/members/games) — regression guard for the Wave A href={base} bug
- [ ] Tray push enable: row hidden when unsupported/no server key/already subscribed/denied/dismissed; enabling lands a push_subscriptions row and a REAL push arrives; "not now" survives reload; profile toggle unchanged
- [ ] Push automation traps (document, don't fight): Chrome bans Push API in incognito (persistent profile required); headless never connects to FCM (headed for delivery proof); CDP grant_permissions doesn't reach the profile Preferences file

## C4. Fix-wave regression lines (2026-07-12, pre-launch QA)
- [ ] A fully-damped 0.00-delta LOSS reads L on seal, profile streak/last-three, Ledger, and feed (never win-green, never "+0.00")
- [ ] The Ledger renders the trio-completing match as poured-marker PLUS its own entry row; the statement arithmetically reconstructs the header
- [ ] Match page pending-confirmation self-heals within ~5s with realtime dead (MatchLive poll)
- [ ] Every rendered time equals the DB value in the session's timezone under TZ=UTC servers (guard test: time-tz-guard)
- [ ] Shell chrome follows soft navigation (⌘K/g-seq); active-circle unread badge lights live
- [ ] Gathering limited-rotation games reject bare RSVP 'in' server-side (rotation_not_locked); home/circle cards render the availability affordance
- [ ] Silence-default games show zero money chrome anywhere
- [ ] A full session's /fc link lands on the truthful state pre-tap; /join offers sign-in to existing users and recognises members

## D. Evidence & exit
- GIF recordings of: join-via-link flow, RSVP morph + live promotion, both-deltas seal, rating reveal, live chat between two tabs
- Defect list filed with severity; fix wave; re-test failures to green
- Exit: all checklist items pass locally → deploy → smoke-repeat auth/circle/chat/RSVP/result on cuatro.fly.dev (prod Supabase)
