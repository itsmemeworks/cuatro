# The CUATRO roadmap

What we are building, and roughly in what order. This is a living document: things move up when real groups ask for them, and down when the evidence says so. If you want something, [open a feature request](https://github.com/itsmemeworks/cuatro/issues/new/choose). We read everything. We do not run the roadmap by vote, but a well-argued issue has moved this list before and will again.

The standing promises, before the list:

- CUATRO is free. No ads, no fees on the core loop, no dark patterns.
- Glass, the rating, stays free forever. You will never pay to see, move or explain your number.
- Your court money never touches us. The Tab tracks it, your bank moves it.
- We will never sell your data. Not aggregated, not anonymised, not once.

## Now: finishing v1.0

The core loop (circle, standing game, RSVP, Fourth Call, result, seal, Ledger, Tab) already runs end to end at [padelcuatro.com](https://padelcuatro.com).

Recently shipped: a branded magic-link email and the delivery to send it; push notifications and the scheduler that fires them on time; error monitoring and a health check that actually reads the database; a durable home for the append-only record on managed Postgres with backups; Friendlies, games that keep the score but leave your rating alone; guest history that follows you when you sign up; circle housekeeping (leave a circle, remove a member, hand over the keys); and the known journey bugs.

What remains before we invite groups beyond our own:

- A consistency pass on the last copy and design details
- The instrumentation to see how a pilot is actually going, so we can learn from it honestly rather than guess

## Next: the first real circles

- Running CUATRO with a small set of real groups, and fixing whatever they trip over before building anything else
- House Rules: report and block on every social surface, and a published takedown route
- The Open Book: this roadmap, GitHub issues as the front door for requests, a plain-English page on [how Glass works](docs/GLASS.md), and a yearly public note on what CUATRO costs and how it is funded
- The Armband: a named Club Captain role for the person who actually does the organising, visible on their profile
- Streaks: how many weeks your standing game has stayed alive, for the circle and for you

## Later: making the loop compound

- Works Circles: a circle badged to your employer, joinable by work email, with its own ladder. Free, like everything else here
- Away Game: find a four in another city, matched to your Glass band, anchored to a venue as always
- Your Padel Year: a seasonal recap of your matches, streaks and Glass journey, made to be shared
- Challenges: circle against circle. Most sessions kept, best reliability month, bragging rights
- Level import: seed your starting Glass from a level you already hold elsewhere, so your history counts here too
- Smaller comforts: chat replies and reactions, better Tab nudges, guests keeping their Glass when they sign up properly

## Someday, and honestly

CUATRO will need to pay for its own court time eventually. When it does, the money will come from optional extras, things like settling the Tab by card in one tap, or deeper Glass stats for the curious. A challenge may carry a sponsor on a prize. None of it will ever mean charging for the rating, the organising, or anything on the list above. The product earns that first.

## Never

- Selling or sharing your data, in any form
- Ads wedged between your matches
- Paywalls on playing, organising, or the rating
- A rating you cannot explain

---

Something missing? [File a feature request](https://github.com/itsmemeworks/cuatro/issues/new/choose). Something broken? Same door, pick the bug form.
