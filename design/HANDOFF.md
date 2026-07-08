# Handoff: CUATRO v0 — Padel Social App

## Overview
CUATRO is a mobile-first consumer social PWA for padel groups ("the app your padel four runs on"). It replaces the WhatsApp thread that organises a weekly game, and carries a skill rating called **Glass** whose defining trait is transparency: every rating movement is explained in an append-only Ledger. This handoff covers the full v0 surface: onboarding + join-via-link, Home, Circle (feed / chat / members), Standing Game, Fourth Call (send + receive), result entry with both-teams confirmation, Profile, the Ledger, the Tab (money), and push-notification content style.

Positioning that must survive implementation: **anti-Playtomic** — warm, transparent, on the players' side. No fees, no ads, no dark patterns, no shame mechanics. Copy is quick-witted, never corporate-cute.

## About the Design Files
The files in this bundle are **design references created in HTML** — interactive prototypes showing intended look and behaviour, NOT production code to copy directly. Your task is to **recreate these designs in the target codebase's environment** (the product spec calls for a Next.js PWA) using its established patterns and libraries. If no codebase exists yet, Next.js + React with CSS variables for the token set below is the intended stack.

The two `.dc.html` files open directly in a browser:
- `CUATRO Prototype.dc.html` — **the primary reference.** One navigable phone: onboarding overlay → tabbed app with working state (RSVP, chat with auto-reply, respect reactions, nudge/settle, Fourth Call escalation, both-teams result confirmation).
- `CUATRO Directions.dc.html` — the exploration document (turns 1–11, newest at top). Reference for: light theme (turn 6), dark theme (turn 7), signature micro-interactions + app icon + OG/meta kit (turn 8), **identity & design tokens (turn 9)**, Circle emblem picker (turn 10), join-via-link flow spec (turn 11).

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, copy and motion values are final-intent. Recreate pixel-perfectly, but implement with your codebase's component patterns. The only placeholder elements are: photo avatars (randomuser.me — replace with real user photos), the "ambient court loop" CSS animation (replace with a real muted 9:16 padel video), and the working title "CUATRO" (wordmark is a type-only lockup precisely so it can be renamed in one place; "Glass" is stable).

## Design Tokens

### Colour (semantic; light / dark — dark is the primary theme)
| token | light | dark | rule |
|---|---|---|---|
| ground | `#FAF8F4` | `#131210` | warm, never pure black/white |
| surface | `#FFFFFF` | `#1E1C19` | cards, sheets, nav |
| surface-feature | `#191713` | `#221F1A` | max ONE per screen — the "up next" card |
| ink | `#191713` | `#F5F2EC` | muted = 55% alpha; hairlines/borders = 9–18% alpha of ink |
| action | `#FF4D2E` | `#FF5C3D` | coral. Exactly ONE action per screen. Text-on-dark variant `#FF8A73`/`#FF7A5C` |
| win / positive | `#1F8A5B` | `#4BC98B` | outcomes + money only; tint = 13% alpha wash |
| loss / negative | `#C23B22` | `#E56B4F` | never used for errors or nags |
| streak | `#B4530A` | `#F2B33D` | rivalries, streaks; tint `#FFF1D6` / 13% alpha |
| court | `rgba(120,170,255,.5)` | same | video scrims + court-line art only |
| Circle colours | 8 curated: `#3E7BFA #2FA05A #E8A33D #C4562C #8C6BF0 #3BB8CE #D65A9E #8A8578` | same | identifies a Circle; NEVER carries actions; marks render white on it |

### Type — two faces, strict jobs
- **Archivo** (Google Fonts): 900 wordmark (tracking −2%), 800 titles + numbers-as-heroes, 700 labels, 400–600 body.
- **IBM Plex Mono**: all metadata — timestamps, money, rating context, ledger explanations. *If it's a fact, it's mono.* `tabular-nums` wherever numbers change.
- Scale: 56 glass-hero · 24 screen title · 19 card title · 13 body · 11.5 secondary · 10 meta (floor).
- Glass values always 2 decimal places, always accompanied by confidence %. Unrated renders `?.??`.

### Space & shape
- 4pt grid; spacing steps 4/8/12/16/24/32; card padding 16; screen gutter 16–18.
- Radius: 999 chips/pills · 14 buttons · 20 cards · 36 device sheet.
- Touch targets ≥44px (RSVP + settle are 48+); primary actions in the bottom half (thumb zone).
- Avatar stacks: overlap −10 to −11px, 2px ring in the ground/surface colour behind them. The **dashed circle** (dashed coral border) = "a space waiting for a person" — the brand's most important component.

### Motion tokens
- `state-change` 250ms ease — colour/copy morphs
- `arrive` 380ms `cubic-bezier(.34,1.56,.64,1)` — things landing (avatar into slot)
- `seal` 450ms ease +120ms delay — confirmations rising
- `reveal` 1500ms ease-out cubic — the Glass pour only
- One haptic per moment, never confetti. `prefers-reduced-motion`: reveals→cross-fades, springs→200ms ease. Ambient video pauses off-screen / low-power.

## Screens / Views
All screens are in `CUATRO Prototype.dc.html` (interact with it — state is real). Detailed static specs for both themes are in `CUATRO Directions.dc.html` turns 6 (light) and 7 (dark).

1. **Onboarding** — full-screen over app. Ambient floodlit-court video behind wordmark (heavy bottom gradient for legibility); Apple (bone bg, black Apple SVG mark), Google (dark bg, 4-colour G SVG), magic-link buttons; highlighted "Got a game link from a mate?" card routes to the join flow. Footer: "no fees · no ads · no dark patterns".
2. **Join-via-link** (the 10-second promise; #1 growth flow) — WhatsApp share card → server-rendered claim page (no account, no bundle; `cuatro.app/g/…`) → "Spot held" + first-name input only → success with avatar joining the four-stack, calendar/directions chips. Spot soft-holds on claim (5:00). Account creation deferred until after the first game. Edge: race loser gets "X beat you to it" → reserve queue with auto-promotion. New joiner arrives Unrated; first game = Placement Trio game 1.
3. **Home** — "Your week": needs-your-answer card on surface-feature (single coral "I'm in" + quiet "Can't"), confirmed-game rows, incoming Fourth Call card (level match + expiry), Tab settle row.
4. **Circle** — segmented Feed / Chat / Members. Feed: pinned next-game bar (RSVP inline), rivalry callout (streak tint), result posts (big score, both Glass deltas, 👏 Respect + 💬 counts, "rematch?"). Chat: bubbles (mine = coral, theirs = surface), typing indicator, composer; the pinned game bar rides above the thread. Members: rows with Glass + confidence, reliability line ("✓ shows up 97%"), role chips (ORGANISER / YOU / NEW), unrated member shows `?.??` + trio progress; dashed "Invite a mate" row.
5. **Standing Game** — "Tuesdays, 8pm" header (repeats weekly, slots lock 24h before); 4 slot rows with status chips; open slot = dashed + "send a Fourth Call"; reserve queue with auto-promotion explainer; £ split row ("goes on the Tab"); quiet underlined "Can't make it anymore?" (drop-out is never red).
6. **Fourth Call — send** (organiser) — escalating rings: 1 the Circle (first refusal, 20 min) → 2 extended network ("people you've played with") → 3 anyone with the link (Copy). Live states: sent ✓ / "Priya passed" / "2 viewing…" / claimed banner with claimant's Glass + level match. Auto-escalates on a timer. **Receive**: full-screen invite, faces, level-match line, one coral "I can play" + quiet Pass, expiry countdown.
7. **Result + confirmation** — team rows with pair averages, set scores, contextual encouragement ("You beat a stronger pair"); "Send to both teams" → per-player confirm ticks → seal banner showing BOTH deltas simultaneously. Glass only moves when both teams confirm.
8. **Profile** — name + reliability chip (social proof, not surveillance) + Circles count; Glass hero card (56px number, confidence bar, season sparkline, "sharpens every time you play"); W–L / streak / best-win stat row; Ledger link; last-three results chips.
9. **The Ledger** (hero transparency moment) — bank-statement-meets-match-report: month headers; rows = result + opponents / mono delta / plain-language *why* / running balance; expanded row adds expected-win %, margin weight, confidence movement; genesis row "Glass poured — Placement Trio complete"; footer "append-only · nothing can be edited or deleted — by anyone".
10. **The Tab** — net position header (mono, ±£); balance rows with one-tap **Nudge** ("Oi. £8 for Tuesday's court 🎾" — sent once, no repeat nags) and coral **Settle**; settled rows collapse to "All square ✓"; activity ledger uses the same row grammar as the rating Ledger; footer "the Tab never charges fees — it just keeps score".
11. **Notifications** — title says *what*, body says *why*: "Your Glass moved / +0.05 → 4.67. Both teams confirmed. Tap to see exactly why." Rules: always say why, never nag twice, no exclamation marks from the system.

## Interactions & Behaviour (signature moments — exact specs in Directions turn 8)
- **RSVP tap**: 250ms colour morph coral→green; user's avatar springs into the slot (`arrive`); one pulse ring; copy flips ("game on"). Dropping out has identical weight — no guilt friction; reserve auto-promotes with a toast.
- **Both-teams confirm**: second confirm pops (`arrive`), 700ms beat, seal card rises (`seal`) with both deltas together — never one team first. Deep haptic on seal only.
- **Rating reveal** (after Placement Trio): digits scramble→settle over 1500ms ease-out; blur(10px)→0 over 900ms in parallel; confidence bar draws last (+250ms); "Glass poured. Welcome to the table." Offer a share card after.
- **Toasts**: bone surface, bottom, 2.1s, 300ms ease in/out.

## State Management (from the prototype's working model)
- `rsvpIn` (bool) — drives home card, feed pinned bar, standing-game slots, head-counts everywhere (single source of truth).
- `fourthCall` — stages: idle → sent-to-circle → escalated (live viewers) → claimed; claiming fills the open slot across all screens and recomputes counts.
- `resultConfirm` — none → sent (awaiting other team) → sealed (writes both ledger deltas).
- `tab` — per-pair balances; `nudged` (once), `settled` flags; net recomputes.
- Chat — message list, draft, typing indicator, unread badge cleared on open.
- Server needs: games + slots + reserve queue, RSVP events, fourth-call escalation timers, result double-confirmation, rating engine emitting explained deltas (expected-win %, margin weight, confidence), per-circle money ledger, push.

## Assets
- **Avatars**: randomuser.me photo placeholders — replace with user uploads.
- **Logos**: Apple mark + Google "G" as inline SVG paths (in the prototype's onboarding) — standard sign-in button assets.
- **Video**: onboarding/Home ambient court loop is a CSS stand-in (court-line plane + floodlight flicker + light sweep) — replace with real muted 9:16 footage, `playsinline`, paused off-screen.
- **App icon / favicon / OG**: specs + mock renders in Directions turn 8 (8e/8f). Icon B = coral square, white Archivo-900 "4"; maskable PWA variant 20% padding; dynamic per-game OG image (faces + one dashed slot); `theme-color` `#131210` dark / `#FAF8F4` light.
- **Fonts**: Archivo + IBM Plex Mono via Google Fonts.

## Files
- `CUATRO-Prototype.dc.html` — navigable, stateful prototype (primary implementation reference)
- `CUATRO-Directions.dc.html` — full exploration: light + dark screen sets, tokens (turn 9), micro-interactions (turn 8), Circle emblem picker (turn 10), join flow spec (turn 11). NOTE: fetched copy truncated at 256KB (newest-first document — the cut content is the oldest exploration turns only).
