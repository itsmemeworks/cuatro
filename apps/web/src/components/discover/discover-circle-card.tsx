"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AvatarStack, Card, Meta, PendingSpinner, Sheet } from "@/components/ui";
import { CircleEmblem } from "@/components/games/roster";
import { circleColorFor } from "@/lib/design";
import {
  CirclePreviewBody,
  circleSubline,
  circleVibeLine,
  knockErrorCopy,
} from "@/components/discover/circle-preview-sheet";
import type { NearbyCircle } from "@/server/open-door";

/**
 * One "Circle open to join" card on Discover. These are OPEN-tier Circles near
 * the viewer's patch (server/open-door.ts, tier === "open"), so the affordance
 * is a circle-knock through the SAME endpoint the phone Open Door card uses
 * (/api/knocks/circle); no new mutation this wave. Outline "Ask to join" per
 * the design — the card carries no coral (the panel's optional coral budget is
 * spent by the games grid, and a directory card asking to join is a quiet act).
 *
 * The pre-join preview sheet body is the SHARED CirclePreviewBody (circle-
 * preview-sheet.tsx) — the same preview a Board card or an outsider's game page
 * opens — rendered here from the card's own already-loaded data, with the
 * card's knock state driving both surfaces so "Asked" can never drift.
 */

export function DiscoverCircleCard({ data }: { data: NearbyCircle }) {
  const router = useRouter();
  const [pending, setPending] = useState(data.hasPendingKnock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const colour = data.colour ?? circleColorFor(data.circleId);
  // "12 members · Sundays" style subline — the design's mono fact under the name.
  const subline = circleSubline(data.memberCount, data.cadence);
  // "Level 3.8–4.6 · rotating pairs" — level first, then the Circle's own vibe line.
  const vibe = circleVibeLine(data.level, data.vibeLine);

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

        {error && <Meta tone="action">{knockErrorCopy(error)}</Meta>}
      </Card>

      {/* Pre-join preview — the shared sheet body, fed from this card's data
          (no refetch) and this card's knock state (card + sheet stay in step). */}
      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={data.name}>
        <CirclePreviewBody
          data={{
            circleId: data.circleId,
            name: data.name,
            vibeLine: data.vibeLine,
            level: data.level,
            venueArea: data.venueArea,
            distanceLabel: data.distanceLabel,
            cadence: data.cadence,
            memberCount: data.memberCount,
            members: data.members,
            openDoor: data.tier === "open",
            hasPendingKnock: pending,
          }}
          knock={{ pending, busy, error, onKnock: knock, onWithdraw: withdraw }}
        />
      </Sheet>
    </>
  );
}
