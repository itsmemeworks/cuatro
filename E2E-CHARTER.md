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

## D. Evidence & exit
- GIF recordings of: join-via-link flow, RSVP morph + live promotion, both-deltas seal, rating reveal, live chat between two tabs
- Defect list filed with severity; fix wave; re-test failures to green
- Exit: all checklist items pass locally → deploy → smoke-repeat auth/circle/chat/RSVP/result on cuatro.fly.dev (prod Supabase)
