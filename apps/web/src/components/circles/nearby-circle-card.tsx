"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Meta, Fact, Sheet, Button } from "@/components/ui";
import { circleColorFor } from "@/lib/design";

/** Serializable mirror of server/open-door.ts's NearbyCircle. */
export interface NearbyCircleData {
  circleId: string;
  name: string;
  emblem: string | null;
  colour: string | null;
  vibeLine: string | null;
  venueArea: string | null;
  distanceLabel: string;
  cadence: string | null;
  memberCount: number;
  level: { min: number; max: number } | null;
  unratedCount: number;
  hasPendingKnock: boolean;
}

// Human copy for the knock-specific error codes — kept local (a page-local map,
// per the repo's error-copy rule) rather than in the shared lib/error-copy.ts.
const KNOCK_ERROR_COPY: Record<string, string> = {
  door_closed: "This Circle just closed its door — try another one near you.",
  already_member: "You're already in this Circle.",
  already_knocked: "You've already knocked here — the organiser will get back to you.",
  is_guest: "Claim your account first, then you can knock.",
  circle_not_found: "That Circle isn't around any more.",
  network_error: "Couldn't reach the server — check your connection and try again.",
  something_went_wrong: "That didn't go through. Give it another tap.",
};

function levelLabel(data: Pick<NearbyCircleData, "level" | "unratedCount">): string {
  const parts: string[] = [];
  if (data.level) {
    parts.push(data.level.min === data.level.max ? data.level.min.toFixed(2) : `${data.level.min.toFixed(2)}–${data.level.max.toFixed(2)}`);
  }
  if (data.unratedCount > 0) parts.push(`${data.unratedCount} still placing`);
  return parts.length ? parts.join(" · ") : "levels forming";
}

export function NearbyCircleCard({ data }: { data: NearbyCircleData }) {
  const router = useRouter();
  const [pending, setPending] = useState(data.hasPendingKnock);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const colour = data.colour ?? circleColorFor(data.circleId);
  const vibe = data.vibeLine ?? "A padel Circle near your patch.";

  async function knock() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/knocks/circle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circleId: data.circleId }),
      });
      const body = await res.json().catch(() => ({}));
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
    <Card className="flex flex-col gap-3">
      <button type="button" onClick={() => setPreviewOpen(true)} className="flex items-start gap-3 text-left w-full">
        <div
          className="w-11 h-11 rounded-card flex items-center justify-center shrink-0"
          style={{ background: colour }}
          aria-hidden
        >
          <span className="text-white font-extrabold text-base">
            {data.emblem ?? data.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-cu-card-title text-ink truncate">{data.name}</p>
          <p className="text-cu-secondary text-ink-muted mt-0.5 line-clamp-2">{vibe}</p>
        </div>
      </button>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Meta>{data.venueArea ?? "Nearby"} · {data.distanceLabel}</Meta>
        <Meta>
          Glass <Fact as="span" size="sm" className="text-ink-muted">{levelLabel(data)}</Fact>
        </Meta>
        <Meta>{data.memberCount} member{data.memberCount === 1 ? "" : "s"}</Meta>
      </div>

      {pending ? (
        <div className="flex items-center justify-between gap-3">
          <Meta>knocked — waiting on the organiser</Meta>
          <Button variant="quiet" onClick={withdraw} disabled={busy}>
            Withdraw
          </Button>
        </div>
      ) : (
        <Button variant="strong" onClick={knock} disabled={busy} fullWidth>
          Knock to join
        </Button>
      )}

      {error && <Meta tone="loss">{KNOCK_ERROR_COPY[error] ?? KNOCK_ERROR_COPY.something_went_wrong}</Meta>}

      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={data.name}>
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-card flex items-center justify-center shrink-0"
            style={{ background: colour }}
            aria-hidden
          >
            <span className="text-white font-extrabold text-base">
              {data.emblem ?? data.name.slice(0, 2).toUpperCase()}
            </span>
          </div>
          <p className="text-cu-body text-ink flex-1">{vibe}</p>
        </div>
        <dl className="mt-4 flex flex-col gap-2">
          <div className="flex justify-between gap-3">
            <Meta as="dt">Where</Meta>
            <Meta as="dd" tone="neutral">{data.venueArea ?? "Nearby"} · {data.distanceLabel}</Meta>
          </div>
          {data.cadence && (
            <div className="flex justify-between gap-3">
              <Meta as="dt">Plays</Meta>
              <Meta as="dd" tone="neutral">{data.cadence}</Meta>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <Meta as="dt">Level</Meta>
            <Fact as="dd" size="sm">{levelLabel(data)}</Fact>
          </div>
          <div className="flex justify-between gap-3">
            <Meta as="dt">Members</Meta>
            <Meta as="dd" tone="neutral">{data.memberCount}</Meta>
          </div>
        </dl>
        <p className="text-cu-meta text-ink-muted mt-4">
          Only the organiser sees your knock — nothing about this Circle is shared until you&apos;re in.
        </p>
        <div className="mt-4">
          {pending ? (
            <Button variant="quiet" onClick={withdraw} disabled={busy} fullWidth>
              Withdraw knock
            </Button>
          ) : (
            <Button variant="strong" onClick={knock} disabled={busy} fullWidth>
              Knock to join
            </Button>
          )}
        </div>
      </Sheet>
    </Card>
  );
}
