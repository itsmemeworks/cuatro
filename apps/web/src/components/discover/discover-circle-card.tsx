"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarStack, Card, Fact, Meta, PendingSpinner, Sheet } from "@/components/ui";
import { CircleEmblem } from "@/components/games/roster";
import { circleColorFor, formatGlass } from "@/lib/design";
import type { NearbyCircle } from "@/server/open-door";

/**
 * One "Circle open to join" card on Discover. These are OPEN-tier Circles near
 * the viewer's patch (server/open-door.ts, tier === "open"), so the affordance
 * is a circle-knock through the SAME endpoint the phone Open Door card uses
 * (/api/knocks/circle); no new mutation this wave. Outline "Ask to join" per
 * the design — the card carries no coral (the panel's optional coral budget is
 * spent by the games grid, and a directory card asking to join is a quiet act).
 */

// Human copy for the circle-knock error codes — a page-local map, matching the
// phone Open Door card (components/circles/nearby-circle-card.tsx). Kept out of
// the shared lib/error-copy.ts because these codes are specific to this flow.
const KNOCK_ERROR_COPY: Record<string, string> = {
  door_closed: "This Circle just closed its door, try another one near you.",
  already_member: "You're already in this Circle.",
  already_knocked: "You've already knocked here, the organiser will get back to you.",
  is_guest: "Claim your account first, then you can knock.",
  circle_not_found: "That Circle isn't around any more.",
  circle_full: "That Circle is at its limit, so no one new can join right now.",
  network_error: "Couldn't reach the server, check your connection and try again.",
  something_went_wrong: "That didn't go through. Give it another tap.",
};

function levelRangeText(level: NearbyCircle["level"]): string | null {
  if (!level) return null;
  return level.min === level.max ? level.min.toFixed(2) : `${level.min.toFixed(2)}–${level.max.toFixed(2)}`;
}

export function DiscoverCircleCard({ data }: { data: NearbyCircle }) {
  const router = useRouter();
  const [pending, setPending] = useState(data.hasPendingKnock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const colour = data.colour ?? circleColorFor(data.circleId);
  const range = levelRangeText(data.level);
  // "12 members · Sundays" style subline — the design's mono fact under the name.
  const subline = [
    `${data.memberCount} member${data.memberCount === 1 ? "" : "s"}`,
    data.cadence,
  ]
    .filter(Boolean)
    .join(" · ");
  // "Level 3.8–4.6 · rotating pairs" — level first, then the Circle's own vibe line.
  const vibe = [range ? `Level ${range}` : "Levels forming", data.vibeLine].filter(Boolean).join(" · ");

  async function knock() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/knocks/circle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circleId: data.circleId }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setPending(true);
        router.refresh();
      } else {
        setError(body?.error ?? "something_went_wrong");
      }
    } catch {
      setError("network_error");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/knocks/circle", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circleId: data.circleId }),
      });
      if (res.ok) {
        setPending(false);
        router.refresh();
      } else {
        setError("something_went_wrong");
      }
    } catch {
      setError("network_error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* The tile itself opens the Circle's pre-join preview (same public,
          aggregate-only facts the phone Open Door sheet shows — a non-member
          can't visit /circles/[id], so the sheet IS the circle's public view).
          A stretched button overlays the card; the ask/withdraw controls sit
          above it (position:relative), so no click is ever dead (QA1, 7b). */}
      <Card className="relative flex flex-col gap-3 transition-cu-state hover:bg-ink-hairline-1">
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          aria-label={`Have a look at ${data.name}`}
          className="absolute inset-0 rounded-card cursor-pointer"
        />
        <div className="flex items-center gap-3">
          <CircleEmblem seed={data.circleId} name={data.name} emblem={data.emblem} colour={colour} px={40} />
          <div className="flex-1 min-w-0">
            <p className="text-cu-card-title text-[15px] text-ink truncate">{data.name}</p>
            <Meta as="p" className="mt-0.5 truncate">
              {subline}
            </Meta>
          </div>
        </div>

        <p className="text-cu-secondary text-ink-muted line-clamp-2">{vibe}</p>

        {data.members.length > 0 && (
          <AvatarStack people={data.members.map((m) => ({ src: m.avatarUrl, name: m.displayName }))} size="sm" max={6} />
        )}

        {pending ? (
          <div className="flex items-center justify-between gap-3">
            <Meta>knocked, waiting on the organiser</Meta>
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="relative text-cu-secondary cursor-pointer font-bold text-ink-muted whitespace-nowrap transition-cu-state hover:text-ink disabled:opacity-50"
            >
              {busy ? <PendingSpinner /> : null} Withdraw
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={knock}
            disabled={busy}
            className="relative inline-flex cursor-pointer items-center justify-center gap-2 rounded-button border border-ink-hairline-4 text-ink font-bold text-[12px] text-center py-2.5 transition-cu-state hover:bg-ink-hairline-1 active:opacity-80 disabled:opacity-50"
          >
            {busy ? <PendingSpinner /> : null} Ask to join
          </button>
        )}

        {error && <Meta tone="action">{KNOCK_ERROR_COPY[error] ?? KNOCK_ERROR_COPY.something_went_wrong}</Meta>}
      </Card>

      {/* Pre-join preview — mirrors the phone Open Door sheet (components/
          circles/nearby-circle-card.tsx): vibe, the public facts, who plays
          here, then the same knock affordance. Aggregate/public data only. */}
      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={data.name}>
        <p className="text-cu-body text-ink">{vibe}</p>
        <div className="mt-4 flex flex-col gap-1">
          <Meta as="p">
            {data.venueArea ?? "Nearby"} · {data.distanceLabel}
          </Meta>
          {data.cadence && <Meta as="p">plays {data.cadence}</Meta>}
          <Meta as="p">{subline}</Meta>
        </div>
        {data.members.length > 0 && (
          <div className="mt-4 flex flex-col gap-1">
            <Meta as="p" className="mb-1">
              Who plays here
            </Meta>
            {data.members.map((m) => (
              <Link
                key={m.userId}
                href={`/players/${m.userId}`}
                className="flex items-center gap-3 py-1.5 rounded-button transition-cu-state hover:bg-ink-hairline-1 active:bg-ink-hairline-1"
              >
                <Avatar src={m.avatarUrl} name={m.displayName} size="md" />
                <div className="flex-1 min-w-0">
                  <span className="text-cu-body text-ink truncate">{m.displayName}</span>
                  {m.role === "organiser" && <Meta as="p">organiser</Meta>}
                </div>
                {m.rating != null ? (
                  <Fact size="md" weight="bold">
                    {formatGlass(m.rating)}
                  </Fact>
                ) : (
                  <Meta>not rated yet</Meta>
                )}
              </Link>
            ))}
          </div>
        )}
        <p className="text-cu-meta text-ink-muted mt-4">
          Only the organiser sees your knock, nothing about this Circle is shared until you&apos;re in.
        </p>
        <div className="mt-4">
          {pending ? (
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="w-full cursor-pointer rounded-button border border-ink-hairline-4 text-ink font-bold text-[12px] text-center py-2.5 transition-cu-state hover:bg-ink-hairline-1 active:opacity-80 disabled:opacity-50"
            >
              {busy ? <PendingSpinner /> : null} Withdraw knock
            </button>
          ) : (
            <button
              type="button"
              onClick={knock}
              disabled={busy}
              className="w-full cursor-pointer rounded-button border border-ink-hairline-4 text-ink font-bold text-[12px] text-center py-2.5 transition-cu-state hover:bg-ink-hairline-1 active:opacity-80 disabled:opacity-50"
            >
              {busy ? <PendingSpinner /> : null} Ask to join
            </button>
          )}
          {error && (
            <Meta as="p" tone="action" className="mt-2">
              {KNOCK_ERROR_COPY[error] ?? KNOCK_ERROR_COPY.something_went_wrong}
            </Meta>
          )}
        </div>
      </Sheet>
    </>
  );
}
