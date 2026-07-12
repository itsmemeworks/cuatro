# HANDOFF DELTA — THE ATLAS (courts, patches, Circles on a map)

Delta to `design_handoff_cuatro_v0/README.md`. Every token, motion and copy rule there still binds; this adds the Atlas surface family. Design reference: `CUATRO Atlas.dc.html` (root, supersedes nothing — it adds Discover's map mode, venue sheets/pages, add-a-court, and the patch control at 430 / 1024 / 1440, both themes).

## Laws restated for the map context
- **Never GPS.** No location permission, no locate-me button, no user pins, no "last seen". People appear only as aggregate counts at venues. The home court is the only anchor there will ever be.
- **One coral moment per panel — the map IS a panel.** At most one dashed-coral marker on screen: the single best open seat for the viewer (in band, soonest). All other open-seat venues render dashed-bone. List panels keep the shipped pattern: one coral CTA, the rest outlined.
- **Dashed coral = a space waiting for a person, only.** Extends to venue markers with an open seat. Add-a-court affordances are NEVER dashed coral (a court is not a person) — they use solid 1px outline rows.
- **Private Circles never appear, anywhere, ever.** Invite-only Circles appear as on Discover (INVITE-ONLY badge, join by link, public preview sheet).
- Facts in IBM Plex Mono · 10px floor · no em dashes, no exclamation marks · distances rough on purpose (`~1 km`, tilde mandatory).

## Map tile styling tokens (MapLibre style, both themes)
Extends the shipped `tMap*` set. The map must look like CUATRO, not a satnav — no default-blue web-map look.

| token | dark | light | use |
|---|---|---|---|
| tMap0 | `#171A20` | `#ECE8E0` | land / canvas |
| tMap1 | `#242933` | `#DBD5C9` | primary roads |
| tMap2 | `#20242D` | `#E2DDD2` | secondary roads |
| tMapPark (new) | `rgba(75,201,139,.08)` | `rgba(31,138,91,.10)` | green space |
| tMapWater (new) | `rgba(120,170,255,.10)` | `rgba(90,130,200,.14)` | water (court-blue hue at low alpha — flagged for review, see punch list) |
| tBlobA / tBlobB (new) | `rgba(255,92,61,.14)` / `.05` | `rgba(216,64,31,.10)` / `.04` | patch blob gradient |

No labels below venue-name zoom except neighbourhood names in Plex Mono at `tInk35`. Attribution bottom-right, mono 10px: `CUATRO tiles · © OpenStreetMap`.

## Marker system
All markers: circle, `translate(-50%,-50%)`, name label Archivo 700 10.5px in `tBone`, sub-line Plex Mono 10px, text-shadow `tTs` for legibility. Tap target ≥44px (visual sizes below sit inside a 44px hit area).

| kind | visual | count | sub-line |
|---|---|---|---|
| home court | 30px solid `tBone`, `◆` glyph in `tOnBone`, 5px ring `tInk12` | — | `your patch anchors here` |
| open seat, in band (max ONE) | 36px `tCard`, 2px dashed `tCoral`, seat count in `tCoralTx` mono, pulse ring | seats open | `1 seat · Sun 10:00` in `tCoralTx` |
| open seat, off band | 32px `tCard`, 2px dashed `tInk35` | seats open | `1 seat · off your band` |
| active venue | 32px `tCard`, 1.5px solid `tInk25` | Circles + games count, mono | `2 Circles` |
| quiet venue | 13px hollow dot, 2px `tInk3`, no count | — | none; name at `tInk5` |
| just added | 18px hollow, 2px solid `tAmberC`, pop-in | — | `just added · by you` in `tAmberC` |
| cluster (zoomed out / country view) | 42px `tCard`, 1px `tInk18`, mono count `tInk7`, city name mono caps `tInk45` | venue count | — |

Cluster rule: cluster when markers would overlap at current zoom; cluster count = venues (not Circles). Country view (no patch set): clusters only, caption `THE UK, ROUGHLY`, footer `venues only · people are never on this map`.

## The patch blob
- Soft irregular blob: `border-radius:46% 54% 52% 48% / 52% 46% 54% 48%`, radial gradient `tBlobA → tBlobB → transparent 78%`. Deliberately vague, never a circle-with-radius, never a crosshair.
- Label `your patch` mono 10px `tCoralTx` at 75% opacity at the blob's south edge.
- Sizes (coarse, human, no km slider): **tight 110px · local 170px · wide 240px** at default zoom (production: three fixed radii, ~1.2 / 2.5 / 5 km, never surfaced as numbers). Copy: tight `your corner of town`, local `a sensible cycle`, wide `worth the trip for a good four`.
- The patch is the camera's home position on every map. The blob is sub-threshold coral wash (≤14% alpha) and does not count as the panel's coral moment — flagged for review.
- Idle motion: `cu-breathe` scale 1→1.05, 7s ease-in-out loop (killed by `prefers-reduced-motion`).

## Motion
- **Marker tap** → sheet rise: 380ms `cubic-bezier(.34,1.56,.64,1)` (`arrive`), scrim fade 200ms.
- **Patch move on home-court change**: blob + mini-map `left/top` 700ms ease; size change 400ms ease. Toast: `home court changed · your patch moved with it`.
- **Open-seat pulse**: box-shadow ring 0→13px fade, 3.4s loop — slow, ambient, not a nag.
- **First-court celebration**: amber seal rises (`seal` 450ms +120ms delay), new marker pops (`arrive` 380ms). One haptic, never confetti.
- **Claim the seat**: 250ms colour morph coral→green (`state-change`), marker flips dashed-coral → solid active in the same beat.

## Screens & behaviours (see the DC for exact copy)
1. **Discover map mode** — List/Map segmented toggle; list default on phone and 1024; at 1440 map and list share the width (map earns the default). Map is a projection of Discover: same Glass band and radius rules as the Board.
2. **Never-GPS reassurance** at first map contact (once, dismissible): `This map never asks where you are` + explanation + `Understood`. Links to patch settings.
3. **Venue sheet** (marker tap; bottom sheet on phone, centred sheet on wide) — name, facts mono, trust chip `home court to N players`, WHO PLAYS HERE with tier badges + Preview (shipped preview sheet), open games with claim/ask, booked-on tile (`court time here books on Playtomic ↗ · CUATRO stays out of the till`), shareable URL `cuatro.app/courts/<slug>` + copy, add/fix-a-fact. Desktop adds `Open the court page →`.
4. **Court page** (shareable, ranks, no owner in v1) — same content at page scale + static map preview captioned `position is postcode-rough`.
5. **Add-a-court** — name + postcode (geocode postcode-level; `✓ E9 5EN checks out · the pin lands there, roughly`), optional indoor/outdoor + court count (`courts · ?` until set), dedupe suggestion on near-match (`Hold on. Did you mean this one?` → coral accepts the existing venue; duplicates are the failure mode), first-court celebration beat (amber, `<name>, welcome to the Atlas`). Community verification is soft: `it earns trust as players call it home`.
6. **Patch control** — mini-map with live blob, home-court picker (the only anchor), coarse size control, reassurance copy. Opens from the patch chip, the rail, and the reassurance banner.
7. **Sparse town** — quiet markers + invitation card: `Shrewsbury has courts. And, for once, no queue` → one coral `Start the first Circle here`.
8. **No patch set** — country view (clusters only) + set-your-patch card (shipped prompt pattern), coral `Set my patch`.

## Copy blocks (pass the kit rules)
- `This map never asks where you are` / `No GPS, no location permission, no locate-me button.`
- `No one runs this court yet. Somewhere else in the UK a 7pm slot just went in four seconds. Not here.`
- `1,553 courts · 559 venues · all of them fighting over the 7pm slot`
- `home court to 14 players` · `trust here is players, not stars`
- `the postcode places the pin, roughly. Rough is the point`
- `one venue, one page. Duplicates split the town in two`
- `<name>, welcome to the Atlas` / `first court in E9 added by a player. That player is you.`
- `CUATRO points at where padel lives and stays out of the till`

## Engineering physics assumed
MapLibre-class library, self-hosted tiles styled with the tokens above; pan/zoom/cluster/tap real. Venue positions geocoded at postcode level (postcodes.io) — never promise building precision. UK seeded from LTA / Find Padel UK class sources at launch; design is world-ready (nothing UK-hardcoded in the language). Static map previews (game-detail pattern) remain for small embeds.

## Out of scope (not designed, on purpose)
Booking/availability · reviews or stars · device location in any form · club-owner accounts/claims · non-UK seeding.
