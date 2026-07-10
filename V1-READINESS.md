# CUATRO v1.0 readiness — synthesis (2026-07-10)

Five parallel audits (journeys, spec, consistency, technical, edges) against build
`93b9708`. Full reports in the session scratchpad; this file is the durable summary.

**Verdict: the product is v1.0-quality for Pete's own group today. It is NOT v1.0
for an external pilot until the cut-line items below are closed.** The core loop
(circle → standing game → RSVP → Fourth Call → result → seal → Ledger → Tab) passed
a live five-persona walkthrough end to end, the copy/design system held across ten
feature waves, and the concurrency model survived adversarial probing.

Already fixed during the review: the one BLOCKER-severity data bug (one match per
session; Reliability >100%) was hotfixed and deployed mid-review (`93b9708`).

## Cut line — must close before declaring v1.0 (external pilot)

1. AUTH: custom SMTP wired + verified from a genuinely external inbox (the only
   sign-in path currently delivers to Supabase team members only). Needs Pete:
   provider choice + API key. Config path: supabase/config.toml [auth.email.smtp]
   + `supabase config push` + raise [auth.rate_limit] email_sent.
2. HEARTBEAT: a scheduler tick (the machine is always-warm; an in-process
   interval suffices) so T-48h Fourth Calls and RSVP-window-open fire without
   anyone opening the app + VAPID keys set in Fly so web push actually sends.
3. SEEING IT BREAK: /api/health does a real DB read; Sentry + global error
   boundary (Pete's stack default; currently zero telemetry).
4. LEDGER SAFETY: Litestream (or scheduled off-box VACUUM INTO) for the SQLite
   volume before real data accrues; current snapshots are not WAL-consistent.
5. PRODUCT BUGS (journeys audit):
   - Court cost cannot be added after Standing Game creation (edit drops it
     silently) → the Tab one-tap split becomes permanently unreachable. Fix +
     make the edit path cost-safe.
   - Circle-feed pinned game "I'm in" silently no-ops when the RSVP window is
     closed (session page handles it correctly; feed surface must match).
   - Knock "tap to decide" notification deep-links to the Feed but the accept
     UI lives under Settings.
   - Name-capture step is device-scoped, not account-scoped → 2nd+ sign-up on
     a device skips it and users appear as email prefixes.
   - Editing a Standing Game's day/time strands the already-materialised next
     session on the old slot with no explanation.
6. CIRCLE LIFECYCLE (edges audit): leave circle, remove member, organiser
   transfer. Without these one inactive organiser permanently orphans a group
   and nobody can ever offboard. (Circle deletion can wait.)
7. PILOT INSTRUMENTATION: the four §9 kill/pivot metrics are not measurable
   today (zero analytics). Minimum: a metrics query script; better: PostHog.
8. CONSISTENCY BATCH (small): played-with GLOSSARY entry + InfoTerm; (app)
   loading.tsx + error.tsx; 3 one-coral violations; loss-tone error in
   nearby-circle-card; "Circle" capitalisation; 2 copy nits (missing space in
   confirm-settled; weekday label on Tab splits).
9. E2E: run the charter's prod smoke against cuatro.fly.dev once SMTP lands
   (it has never been run against prod), re-driving the post-2026-07-08 waves.

## Explicitly deferred to v1.1 (recommended)

- Playtomic prior import UI (spec promised; engine support exists, no input).
- Chat replies + emoji reactions (spec says v0; shipped text-only).
- Tab nudge deep-link to payment rails.
- Dispute resolution flow (disputes are currently terminal).
- Rate limiting + ring-3 guest/reserve-queue caps (public-link spam).
- Guest→existing-account conversion carrying Glass history (currently strands).
- Offline fallback + install nudge (PWA is online-only today).
- Perf: matches player-id indexes, app-shell + /games N+1s (bite at league
  scale, not pilot scale). rsvpInCount toggle-pumping fairness fix.
- i18n externalisation (invisible for UK launch).

## Needs Pete's blessing (spec contradictions shipped deliberately)

- Ring-3 public claim links (spec deferred open-strangers to v1; shipped as
  HMAC links — richer than spec but re-opens the deferred trust surface).
- Ring 2 redefinition: played-with + geo Local Ring instead of the spec's
  "members of your other Circles" (better, but spec must be updated).
- Public player profiles incl. full public Ledger (Pete called this).
- DESIGN.md refresh to cover the discovery subsystem + the above.

## What passed clean (no action)

Live five-persona journeys (organiser, invited mate, discovery stranger, game
lifecycle incl. no-show sub, Tab settle back-half); copy rules (0 em dashes,
0 exclamations, 0 raw slugs); empty states; concurrency invariants (RSVP races,
capacity, promotion, holds, double-confirm); invite entropy; HMAC links; secrets
hygiene; identity-from-session; guest cookie scope; append-only Ledger.
