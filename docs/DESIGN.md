# CUATRO — the app your padel four runs on

*v0 spec · 2026-07-08 · working title (see Naming). Research basis: `RESEARCH.md` + `research/01–05`. Review site: https://padel-research.fly.dev*

**One-liner:** The group operating system for padel — a consumer social app where your four organises itself, everyone shows up, and every result feeds a rating you can actually see through.

**Decisions locked (Pete, 2026-07-08):**
1. v0 = **Group OS + rating only** — pure player-side, zero platform risk. No booking, no scraping, no aggregation, no holding money.
2. **UK-only launch, world-ready plumbing** — everything country-parameterised from day one.
3. **Consumer social brand** — not infrastructure, not B2B. The rating is a feature of the social product (and quietly becomes the standard later).

---

## 1. The Economics

### The strategic trade we're making
v0 deliberately earns almost nothing. What it accumulates is the two assets Playtomic's €29M/yr business is actually built on — **the social graph of who plays with whom** and **a trusted rating** — without touching the two things that make challengers die (club sales cycles, platform/scraping risk). Playtomic cannot respond in kind: making its rating transparent and portable detonates its own lock-in. That asymmetry is the whole bet.

### Money path (phased, honest numbers)
| Phase | Product | Who pays | Worked number |
|---|---|---|---|
| **v0 (mo 0–9)** | Group OS + Glass Rating, free | Nobody (by design) | Target: 2,500 Circles ≈ 25k UK players by month 9 |
| **v1 (mo 9–18)** | **Cuatro Plus** £3.99/mo: deep stats, form graphs, unlimited Circles, custom Standing Game rules, early features | Organisers + stats nerds | 25k → 80k users; 6% Plus ≈ £19k MRR |
| **v1.5** | Court availability alerts (needs aggregation — re-opens platform risk, decide then) | Players | Padel Snipe proves willingness to pay for this alone |
| **Phase B (18mo+)** | Zero-commission club SaaS: "your data is yours" — sold INTO an audience of clubs whose players already run on Cuatro | Clubs | 100 clubs × £150/mo = £15k MRR; UK has 559+ venues growing 78%/yr |

At 80k UK users (20% of today's 400k GB players, a market itself growing) with 6% Plus penetration, the consumer line alone is ~£230k ARR — and the real prize is that Phase B starts with warm demand instead of cold calls.

### The growth loop (why CAC ≈ 0)
Padel is played in fours and organised in groups — **the product is invited into WhatsApp groups by its own users**:
1. One organiser adopts Cuatro for their Tuesday game → posts the RSVP link into the existing WhatsApp group.
2. Three+ players tap the link, see the game, join to RSVP (10-second onboarding, no rating questionnaire).
3. Each new player belongs to ~2–3 other padel groups → repeats step 1.

Every **Standing Game** is a weekly recurring invitation event. If an average Circle of 10 players exposes 1 new organiser per month, monthly growth compounds at ~30–40% during the beachhead phase without paid acquisition. The wedge user is the **organiser** — the person currently suffering "47 WhatsApp messages to organise one match." Win them, win the group.

---

## 2. The Mechanics (named)

### GLASS — the rating you can see through
*Padel is played in a glass box. So is your rating.*

A 1.00–7.00 scale (deliberately mappable from Playtomic — players understand "I'm a 3.4"), but with every property Playtomic's rating is hated for inverted:

| Playtomic | GLASS |
|---|---|
| Inflated self-assessment at signup | **No questionnaire.** You start Unrated; your number appears after the **Placement Trio** (first 3 verified matches) |
| Opaque — "you see the number, not the story" | **The Ledger** — every match shows its exact delta and why: "+0.04 — beat a stronger pair 6-3 6-4" |
| Sandbaggable via friend-farming | **Echo Damping** — repeat fixtures decay: 2nd time you play the same four in 30 days counts ×0.6, 3rd ×0.36, … |
| Reliability rewards volume, not variety | **Confidence** grows only with *opponent diversity*: each new verified opponent +8%, capped at 95%. Play 50 games against the same eight people and Glass tells everyone your number is soft |
| Results self-reported into the void | **Verified Results** — both teams confirm the score in-app; unconfirmed matches don't move anyone |
| Coaching recalibration punishes you | No resets, ever. Movement only from verified play |

**The math (worked example).** Standard ELO on team averages, K scaled by confidence and margin:

- Team A: 4.10 + 3.70 → 3.90. Team B: 3.95 + 3.65 → 3.80.
- Win expectancy: P(A) = 1 / (1 + 10^(−(3.90−3.80)/0.5)) = **0.613**.
- A wins 6-3 6-4 (12 of 19 games → margin multiplier 1 + (12/19 − 0.5) = **1.13**).
- Delta per A player = K × (1 − P) × margin = 0.04 × 0.387 × 1.13 ≈ **+0.017** (K=0.04 at high confidence; 0.12 during Placement so new players calibrate in ~10 matches, not months).
- The Ledger entry a player sees: **"+0.02 · beat a slightly weaker pair, comfortable margin · vs J, K (first meeting — full weight)"**. (Direction language is always computed from the actual rating gap.)

Glass is world-universal by construction — no country in the math. That's the quiet Trojan horse: when we expand, the rating already travels.

### CIRCLES — your padel groups
A Circle is a persistent group: members, chat, history, the Tab, its Standing Games. Players belong to many Circles (Tuesday work crowd, weekend fours, holiday group). Join by link or QR — **no phone numbers exchanged, ever** (the #3 wishlist item). A Circle's feed is its memory: results, streaks, rivalries ("K has beaten you 6 times running"), milestones. This is the consumer-social heart — the product should feel like the group's clubhouse, not a booking utility.

### STANDING GAME — the game that organises itself
The recurring fixture, e.g. *Tuesdays 20:00, Powerleague Shoreditch, 4 slots.* Mechanics:
- **RSVP window** opens automatically (default 6 days out, configurable). Members tap in/out; first four hold the slots, rest queue as reserves.
- **Auto-promotion:** a dropout instantly promotes reserve #1 and notifies the group.
- If slots remain at **T-48h**, a **Fourth Call** fires automatically.
- Court booking stays wherever it is today (the organiser books on Playtomic/club site as usual — v0 explicitly does NOT touch booking). The Standing Game holds the *people*, which is the hard part.

### FOURTH CALL — filling the empty slot
The escalating cascade when a game is short (canonical padel pain: "finding a fourth"):
1. **Circle** — reserves and members not yet in.
2. **Extended network** — members of your other Circles + friends-of-Circle within the right Glass band (±0.5 default), same city.
3. **Open call (v1)** — public matchmaking to strangers. Deliberately deferred: open matchmaking with strangers is only safe once Glass has real coverage; a bad stranger-match experience is the thing that kills trust first.

Every Fourth Call answer is a growth event — it pulls players from adjacent groups into yours.

### RELIABILITY — the anti-no-show
Separate from skill, attached to every profile: **show-up rate + RSVP discipline** (confirmed-then-cancelled inside 24h counts against; genuine early cancels don't). Shown as a simple badge (e.g. ✓ 97%). No fines, no debt-locking, no chatbot tribunals — organisers just quietly stop calling unreliable players, which is how real groups already work. (Anybuddy's "reliability index" is the only prior art; nobody has made it social.)

### THE TAB — who owes what
Zero-platform-risk money: Cuatro **never holds funds** (no FCA perimeter, no refund chatbots — the #3 complaint category structurally impossible). The organiser pays for the court as they do today; the Tab records each player's share, tracks running balances per Circle, and fires one-tap payment nudges deep-linking to native rails (bank app / payment link). Settlement is marked by counterparty confirmation. v2 option: real card-holds via a licensed PSP — only if the Tab's data proves demand.

---

## 3. The Loop
**Organise** (Standing Game runs itself) → **Fill** (Fourth Call on Glass bands) → **Play** (court booked wherever, like today) → **Log** (both teams confirm; Ledger explains every delta) → **Compound** (Circle history, streaks, rivalries, Reliability) → repeat weekly, forever.

Playtomic's version of this loop breaks at "log" (opaque rating) and never had "organise" at all.

---

## 4. Scope

### v0 ships
- Circles: create/join by link+QR, chat (text, replies, emoji reactions), feed, member list
- Standing Games: RSVP windows, reserves, auto-promotion, T-48h Fourth Call trigger
- Fourth Call levels 1–2 (Circle + extended network)
- Glass: Placement Trio, verified results, the Ledger, Echo Damping, Confidence
- Reliability badges
- The Tab: shares, balances, nudges, confirm-settle
- Profiles: Glass + Confidence + Reliability + history
- Push notifications (the product's heartbeat: RSVP opens, promotions, Fourth Calls, result confirmations)
- One-time Playtomic level import: manual "I'm a 3.4 on Playtomic" seeds the Placement prior only (never displayed as Glass)

### v0 explicitly does NOT ship
- ❌ Court booking, availability, prices, or any club integration
- ❌ Scraping/aggregation of any platform (zero platform risk — locked decision)
- ❌ Holding money
- ❌ Open matchmaking with strangers (v1, once Glass coverage exists)
- ❌ Tournaments/americanos (v1 — table stakes, not wedge), video/stats hardware anything
- ❌ Native app-store apps (PWA first; wrapper later if push/installation metrics demand it)

---

## 5. World-ready plumbing (UK-only launch)
- **Country as data, not code:** users, Circles and venues carry `country_code`; launch gate is a config flag (`enabled_countries = ["GB"]`), not schema.
- **Money fields** are `amount_minor + currency` everywhere (Tab is currency-aware from day one).
- **i18n:** all strings externalised (en-GB at launch); dates/times through locale formatting; es/sv are the obvious next locales.
- **Venues** are free-text + optional place lookup at v0 (we don't own a club directory yet) but stored as a first-class table ready to become one.
- **Timezones** per Circle/venue, not per server. **Phone-agnostic auth** (email magic link + Apple/Google) — no SMS dependency that breaks abroad.
- **Glass** is country-free math by design.

---

## 6. Stack & Architecture
Per stack defaults (ADHX patterns):
- **Next.js 16** PWA, mobile-first (installable; iOS/Android web push)
- **Postgres in each environment's Supabase project + Drizzle** (managed backups; superseded SQLite-on-volume 2026-07-10, Pete-blessed)
- **Vitest** — rating engine gets exhaustive unit coverage (deltas, damping, confidence, placement) as pure functions; simulation test: 10k synthetic matches must converge known-skill agents to ±0.2
- **Fly.io** (app: `cuatro`, lhr), **Sentry**
- Chat/feed realtime via SSE (fine at v0 scale)
- Auth: email magic link + Apple/Google OAuth
- Core tables: `users, circles, circle_members, standing_games, sessions (game instances), rsvps, matches, match_confirmations, rating_events (the Ledger — append-only), tabs, tab_entries, venues, notifications`

**The Ledger is append-only and user-visible by design** — transparency isn't a UI feature bolted on, it's the storage model.

---

## 7. Build plan
1. **M1 — Skeleton (wk 1):** auth, Circles, chat, profiles; deployed to Fly
2. **M2 — The Organiser (wk 2):** Standing Games, RSVP, reserves, push
3. **M3 — Glass (wk 3):** rating engine (pure lib + tests + simulation), verified results, Ledger UI, Placement
4. **M4 — Fill & Money (wk 4):** Fourth Call 1–2, Reliability, the Tab
5. **M5 — Polish + pilot (wk 5–6):** onboarding via real WhatsApp-group migration script, seed 5–10 real London Circles, watch retention

Kill/pivot signal at pilot: if organisers won't move their group's RSVP flow out of WhatsApp even with zero friction, the wedge is wrong — learn before scaling.

## 8. Risks
| Risk | Mitigation |
|---|---|
| **Cold-start chicken/egg on ratings** | Glass needs matches, matches don't need Glass — the Group OS is fully useful unrated; rating emerges as a by-product |
| **WhatsApp inertia** (the real competitor is a group chat) | Organiser-first design: the RSVP link works *inside* WhatsApp before anyone installs anything |
| **Playtomic ships transparency** | They'd have to expose the inflation/opacity their liquidity depends on; most-likely response is copying Circles, which doesn't transfer their rating problem |
| **Padel Mates pivots player-side in UK** | They're club-SaaS-led and buggy; our speed + consumer polish is the counter |
| **Consumer social apps die quietly** | Weekly Standing Games are a built-in retention metronome — the product has an appointment with every user every week |

## 9. Success metrics (pilot → v1 gate)
- ≥60% of pilot Circles still running their Standing Game through Cuatro at week 8
- ≥70% of played matches confirmed by both teams (Glass integrity)
- Median Fourth Call fill time < 12h
- ≥1 organic Circle created per 3 seeded ones (the loop works)

## 10. Naming
Working title **CUATRO** — the four, the thing the whole product exists to assemble; short, shoutable, padel-Spanish without being niche. The rating keeps its own name (**Glass**) so it can someday outgrow the app. Alternates if cuatro.app/handles are blocked: **BANDEJA**, **QUARTA**, **FOURS**. Check domains/handles before M1; naming is Pete's call.
