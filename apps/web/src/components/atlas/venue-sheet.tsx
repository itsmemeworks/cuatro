"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Meta, PendingSpinner, Sheet } from "@/components/ui";
import { CirclePreviewTrigger } from "@/components/discover/circle-preview-sheet";
import type { CourtView, CourtCircle, CourtOpenGame, CourtBooking } from "@/server/court-page";

/**
 * THE ATLAS venue sheet + the presentational pieces the court page reuses.
 *
 *  - `VenueSheet`      — self-contained: lazily fetches /api/courts/[slug] on
 *    first open and renders the body inside <Sheet>. This is what the Discover
 *    map (T3) mounts on a marker tap — it only needs a slug + name.
 *  - `VenueSheetBody`  — the presentational sheet content (facts, WHO PLAYS
 *    HERE, open games, booking, share, fix-a-fact). Render it inside your own
 *    <Sheet> if you already hold a CourtView.
 *  - `WhoPlaysHere` / `OpenGames` / `BookingTile` / `CopyLinkRow` — the shared
 *    blocks the court page (app/courts/[slug]) lays out at page scale.
 *
 * Privacy is enforced upstream in server/court-page.ts (private Circles are
 * never in `data.circles`); this file never re-filters — the Preview affordance
 * reuses CirclePreviewTrigger VERBATIM, and a private Circle simply never
 * reaches here to be previewed.
 */

export type { CourtView } from "@/server/court-page";

/** Emblem if the organiser set one, else a two-letter monogram from the name. */
function monogram(name: string, emblem: string | null): string {
  if (emblem) return emblem;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const TIER_LABEL: Record<CourtCircle["tier"], string> = { open: "OPEN", invite_only: "INVITE-ONLY" };

function circleMeta(memberCount: number, cadence: string | null): string {
  const members = `${memberCount} member${memberCount === 1 ? "" : "s"}`;
  return cadence ? `${members} · ${cadence}` : members;
}

/** The green trust chip: "home court to N players" + the players-not-stars line. */
export function TrustChip({ homeLine, showTrustLine = false }: { homeLine: string; showTrustLine?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-chip bg-win-tint px-3 py-1.5 text-[11px] font-bold text-win">{homeLine}</span>
      {showTrustLine && <Meta>trust here is players, not stars</Meta>}
    </div>
  );
}

/** One "WHO PLAYS HERE" row: monogram, name, meta, tier badge, Preview. */
function CircleRow({ circle }: { circle: CourtCircle }) {
  return (
    <div className="flex items-center gap-3 border-b border-ink-hairline-1 py-2.5 last:border-b-0">
      <span
        aria-hidden
        className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] text-[11.5px] font-extrabold text-white"
        style={{ background: circle.colour ?? "var(--color-ink-hairline-3)" }}
      >
        {monogram(circle.name, circle.emblem)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-extrabold text-ink">{circle.name}</p>
        <Meta as="p">{circleMeta(circle.memberCount, circle.cadence)}</Meta>
      </div>
      <span
        className={`rounded-chip px-2.5 py-1 text-[10px] font-bold tracking-[0.05em] ${
          circle.tier === "open" ? "bg-win-tint text-win" : "bg-ink-hairline-2 text-ink-muted"
        }`}
      >
        {TIER_LABEL[circle.tier]}
      </span>
      <CirclePreviewTrigger
        circleId={circle.circleId}
        circleName={circle.name}
        className="flex-none rounded-chip border border-ink-hairline-3 px-3 py-1.5 text-[10.5px] font-bold text-ink hover:bg-ink-hairline-1"
      >
        Preview
      </CirclePreviewTrigger>
    </div>
  );
}

/**
 * WHO PLAYS HERE — the Circles list, or the quiet cold-start block. The quiet
 * block carries the ONE coral moment on the panel ("Be the first"); the
 * populated list has no coral (open-game links stay neutral).
 */
export function WhoPlaysHere({ circles }: { circles: CourtCircle[] }) {
  if (circles.length === 0) {
    return (
      <div className="rounded-card bg-ink-hairline-1 p-4">
        <p className="text-[13.5px] font-extrabold text-ink">No one runs this court yet</p>
        <p className="mt-1 text-cu-body leading-relaxed text-ink-muted">
          Somewhere else in the UK a 7pm slot just went in four seconds. Not here.
        </p>
        <Link
          href="/circles/new"
          className="mt-3 block rounded-button bg-action py-2.5 text-center text-[12px] font-extrabold text-action-contrast transition-cu-state hover:opacity-90 active:opacity-80"
        >
          Be the first · start a Circle here
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <Meta as="p" className="mb-1 font-extrabold tracking-[0.13em]">
        WHO PLAYS HERE
      </Meta>
      {circles.map((c) => (
        <CircleRow key={c.circleId} circle={c} />
      ))}
      <Meta as="p" className="pt-2.5">
        private Circles never appear here, or anywhere
      </Meta>
    </div>
  );
}

/** One open game — the whole row links to its session page, where the real claim/ask lives. */
function OpenGameLink({ game }: { game: CourtOpenGame }) {
  return (
    <Link
      href={`/games/${game.sessionId}`}
      className="flex items-center gap-3 rounded-card bg-ink-hairline-1 px-3 py-3 transition-cu-state hover:bg-ink-hairline-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-extrabold text-ink">{game.whenLabel}</p>
        <Meta as="p" className="mt-0.5">
          {game.line}
        </Meta>
      </div>
      <span className="flex-none rounded-button border border-ink-hairline-3 px-3.5 py-2 text-[12px] font-extrabold text-ink">
        {game.slotsOpen === 1 ? "1 seat →" : `${game.slotsOpen} seats →`}
      </span>
    </Link>
  );
}

/** OPEN GAMES section — nothing renders when there are none. */
export function OpenGames({ games }: { games: CourtOpenGame[] }) {
  if (games.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <Meta as="p" className="font-extrabold tracking-[0.13em]">
        OPEN GAMES
      </Meta>
      {games.map((g) => (
        <OpenGameLink key={g.sessionId} game={g} />
      ))}
    </div>
  );
}

/**
 * Booked-on signpost tile (two-letter tile, never a logo). CUATRO stays out of
 * the till. The `page` variant carries the fuller court-page tagline; the sheet
 * keeps it short.
 */
export function BookingTile({ booking, variant = "sheet" }: { booking: CourtBooking; variant?: "sheet" | "page" }) {
  return (
    <div className="rounded-card bg-ink-hairline-1 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-6 w-6 flex-none items-center justify-center rounded-lg bg-ink-hairline-2 text-[10px] font-extrabold text-ink/75"
        >
          {booking.tile}
        </span>
        <span className="font-mono text-[10.5px] text-ink-muted">court time here books on {booking.label} ↗</span>
      </div>
      <Meta as="p" className="mt-1">
        {variant === "page" ? "CUATRO points at where padel lives and stays out of the till" : "CUATRO stays out of the till"}
      </Meta>
    </div>
  );
}

/**
 * Shareable URL row + copy button. The DISPLAYED and COPIED URL are both built
 * from the live origin (repo law: world-ready, never hardcode a domain). On the
 * server-rendered court page `origin` is passed in (from the request); in the
 * client sheet it is read from window.location after mount.
 */
export function CopyLinkRow({ slug, origin }: { slug: string; origin?: string }) {
  const [resolvedOrigin, setResolvedOrigin] = useState(origin ?? "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!origin && typeof window !== "undefined") setResolvedOrigin(window.location.origin);
  }, [origin]);

  const url = `${resolvedOrigin}/courts/${slug}`;
  const display = resolvedOrigin ? `${resolvedOrigin.replace(/^https?:\/\//, "")}/courts/${slug}` : `/courts/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (insecure context / permissions) — the row still shows the URL */
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate rounded-button border border-ink-hairline-1 bg-ink-hairline-1 px-3 py-2.5 font-mono text-[10px] text-ink-muted">
        {display}
      </span>
      <button
        type="button"
        onClick={copy}
        className="flex-none rounded-button border border-ink-hairline-3 px-3.5 py-2.5 text-[11px] font-bold text-ink transition-cu-state hover:bg-ink-hairline-1 active:opacity-80"
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
    </div>
  );
}

/**
 * "Add or fix a fact" — a solid 1px outline row (NEVER dashed coral: a court is
 * not a person). Links to the profile settings venue flow (T5 owns it).
 */
export function FixFactRow({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/profile/settings"
      className={`block rounded-button border border-ink-hairline-3 py-2.5 text-center text-[11.5px] font-bold text-ink transition-cu-state hover:bg-ink-hairline-1 active:opacity-80 ${className}`}
    >
      Add or fix a fact
    </Link>
  );
}

/** The sheet's stacked body (see the court page for the wide two-column layout of the same content). */
export function VenueSheetBody({ data, showCourtPageLink = false }: { data: CourtView; showCourtPageLink?: boolean }) {
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h2 className="text-[20px] font-extrabold leading-tight tracking-[-0.01em] text-ink">{data.name}</h2>
        <p className="mt-1.5 font-mono text-[10.5px] text-ink-muted">{data.factsLine}</p>
      </div>
      <TrustChip homeLine={data.homeLine} />
      <WhoPlaysHere circles={data.circles} />
      <OpenGames games={data.openGames} />
      {data.booking && <BookingTile booking={data.booking} />}
      <CopyLinkRow slug={data.slug} />
      <div className="flex items-center gap-2.5">
        <FixFactRow className="flex-1" />
        {showCourtPageLink && (
          <Link
            href={`/courts/${data.slug}`}
            className="flex-1 rounded-button border border-ink-hairline-3 py-2.5 text-center text-[11.5px] font-bold text-ink transition-cu-state hover:bg-ink-hairline-1 active:opacity-80"
          >
            Open the court page →
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * Self-contained venue sheet: fetches the court view on first open (same lazy
 * pattern as CirclePreviewSheet). T3 mounts this on a Discover marker tap with
 * just the venue's slug + name.
 */
export function VenueSheet({
  slug,
  venueName,
  open,
  onClose,
  showCourtPageLink = false,
}: {
  slug: string;
  venueName: string;
  open: boolean;
  onClose: () => void;
  showCourtPageLink?: boolean;
}) {
  const [data, setData] = useState<CourtView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!open || data || loadFailed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/courts/${encodeURIComponent(slug)}`);
        const body = (await res.json().catch(() => null)) as { ok?: boolean; court?: CourtView } | null;
        if (cancelled) return;
        if (res.ok && body?.ok && body.court) setData(body.court);
        else setLoadFailed(true);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, data, loadFailed, slug]);

  return (
    <Sheet open={open} onClose={onClose} title={data ? undefined : venueName}>
      {data ? (
        <VenueSheetBody data={data} showCourtPageLink={showCourtPageLink} />
      ) : loadFailed ? (
        <p className="text-cu-body text-ink-muted">This court is keeping its details to itself for now.</p>
      ) : (
        <div className="flex items-center gap-2 py-2 text-ink-muted">
          <PendingSpinner /> <Meta>having a look</Meta>
        </div>
      )}
    </Sheet>
  );
}
