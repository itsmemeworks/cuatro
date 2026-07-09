import { HEADER_KEYS, headerUrl, resolveHeaderUrl, type HeaderKey } from "@/lib/circle-headers";
import { HEADER_LABELS } from "./presets";

/**
 * The Circle header image, everywhere a Circle presents itself (Circle v2).
 * Every Circle gets a curated photo with zero setup: an organiser's explicit
 * `headerImage` key wins, otherwise a stable one is auto-assigned from the
 * Circle id (lib/circle-headers.ts's resolveHeaderUrl). The image is always
 * self-hosted (offline PWA + CSP forbid remote hosts).
 *
 * A dark bottom scrim carries the emblem + name so they stay legible over any
 * photo — the name is the one thing that must never wash out. The emblem disc
 * keeps the Circle's own colour (identity, never coral).
 */

const SCRIM =
  "linear-gradient(to top, rgba(15,13,10,0.82) 0%, rgba(15,13,10,0.45) 42%, rgba(15,13,10,0.08) 100%)";

/** The Circle's coloured emblem disc, rendered over the header scrim. */
function EmblemDisc({ colour, emblem, name, px }: { colour: string; emblem: string | null; name: string; px: number }) {
  return (
    <div
      className="rounded-card flex items-center justify-center shrink-0"
      style={{ background: colour, width: px, height: px, boxShadow: "0 1px 4px rgba(0,0,0,0.35)" }}
      aria-hidden
    >
      <span className="text-white font-extrabold" style={{ fontSize: px * 0.42 }}>
        {emblem ?? name.slice(0, 2).toUpperCase()}
      </span>
    </div>
  );
}

/**
 * The tall hero at the top of a Circle's own detail page (448px column). The
 * name reads as a title over the photo; a caller-supplied `facts` line rides
 * beneath it in the same scrim.
 */
export function CircleHeaderHero({
  circleId,
  headerImage,
  colour,
  emblem,
  name,
  facts,
}: {
  circleId: string;
  headerImage: string | null;
  colour: string;
  emblem: string | null;
  name: string;
  facts?: React.ReactNode;
}) {
  return (
    <div className="relative rounded-card overflow-hidden" style={{ height: 168 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted curated header; next/image adds little in the phone frame. */}
      <img src={resolveHeaderUrl(circleId, headerImage)} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0" style={{ background: SCRIM }} />
      <div className="absolute inset-x-0 bottom-0 p-4 flex items-end gap-3">
        <EmblemDisc colour={colour} emblem={emblem} name={name} px={52} />
        <div className="min-w-0 pb-0.5">
          <h1 className="text-white font-extrabold truncate" style={{ fontSize: 22, textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>
            {name}
          </h1>
          {facts != null && (
            <p className="font-mono tabular-nums text-[11px] mt-0.5" style={{ color: "rgba(245,242,236,0.9)", textShadow: "0 1px 4px rgba(0,0,0,0.55)" }}>
              {facts}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The shorter header strip used as card art on the /circles list and the
 * "Circles near you" directory. Same treatment as the hero, smaller; the
 * card body (facts, actions) sits on the surface below it.
 */
export function CircleCardArt({
  circleId,
  headerImage,
  colour,
  emblem,
  name,
}: {
  circleId: string;
  headerImage: string | null;
  colour: string;
  emblem: string | null;
  name: string;
}) {
  return (
    <div className="relative" style={{ height: 108 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted curated header. */}
      <img src={resolveHeaderUrl(circleId, headerImage)} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0" style={{ background: SCRIM }} />
      <div className="absolute inset-x-0 bottom-0 p-3 flex items-end gap-2.5">
        <EmblemDisc colour={colour} emblem={emblem} name={name} px={38} />
        <p className="text-white font-extrabold truncate" style={{ fontSize: 17, textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>
          {name}
        </p>
      </div>
    </div>
  );
}

/**
 * The header picker for the create form and Edit Circle sheet: a grid of the
 * 12 curated thumbnails with the current one ringed. Selecting a thumbnail
 * sends its key up; Shuffle picks a random different one, so a "pick me one"
 * organiser gets a fresh look in a tap. A plain (hookless) component — the
 * client parent owns the selected-key state.
 */
export function HeaderPicker({
  selected,
  onChange,
}: {
  selected: HeaderKey;
  onChange: (key: HeaderKey) => void;
}) {
  function shuffle() {
    const others = HEADER_KEYS.filter((k) => k !== selected);
    onChange(others[Math.floor(Math.random() * others.length)]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-cu-meta uppercase tracking-[0.14em] text-ink-muted">Header</span>
        <button
          type="button"
          onClick={shuffle}
          className="text-cu-meta font-bold text-ink-muted rounded-chip border border-ink-hairline-3 px-2.5 py-1 transition-cu-state active:opacity-80"
        >
          Shuffle
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {HEADER_KEYS.map((key) => {
          const active = key === selected;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={active}
              aria-label={HEADER_LABELS[key]}
              className="relative rounded-button overflow-hidden aspect-video transition-cu-state"
              style={{ boxShadow: active ? "0 0 0 2px var(--color-surface), 0 0 0 4px var(--color-action)" : "none" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- self-hosted curated thumbnails. */}
              <img src={headerUrl(key)} alt="" aria-hidden className="w-full h-full object-cover" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
