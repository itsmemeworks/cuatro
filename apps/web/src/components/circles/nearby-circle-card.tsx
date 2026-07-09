"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Meta, Fact, Sheet, Button } from "@/components/ui";
import { BoardCard, type BoardCardProps } from "@/components/games/board-card";
import { circleColorFor } from "@/lib/design";

/** One open game an invite-only Circle carries; mirrors server/open-door.ts's NearbyCircleOpenGame. */
export interface NearbyCircleOpenGameData {
  sessionId: string;
  venueName: string | null;
  startsAtMs: number;
  distanceLabel: string;
  levelLine: string;
  slotsOpen: number;
  viewerHasPendingKnock: boolean;
}

/** Serializable mirror of server/open-door.ts's NearbyCircle. */
export interface NearbyCircleData {
  circleId: string;
  name: string;
  emblem: string | null;
  colour: string | null;
  vibeLine: string | null;
  tier: "open" | "invite_only";
  venueArea: string | null;
  distanceLabel: string;
  cadence: string | null;
  memberCount: number;
  level: { min: number; max: number } | null;
  unratedCount: number;
  hasPendingKnock: boolean;
  openGames: NearbyCircleOpenGameData[];
}

// Human copy for the knock-specific error codes — kept local (a page-local map,
// per the repo's error-copy rule) rather than in the shared lib/error-copy.ts.
const KNOCK_ERROR_COPY: Record<string, string> = {
  door_closed: "This Circle just closed its door, try another one near you.",
  already_member: "You're already in this Circle.",
  already_knocked: "You've already knocked here, the organiser will get back to you.",
  is_guest: "Claim your account first, then you can knock.",
  circle_not_found: "That Circle isn't around any more.",
  network_error: "Couldn't reach the server, check your connection and try again.",
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

/** Same "when" format The Board uses on Home, so an ask reads identically wherever it appears. */
function whenLabelFor(startsAtMs: number): string {
  return new Date(startsAtMs).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EmblemMark({ colour, emblem, name, size }: { colour: string; emblem: string | null; name: string; size: "sm" | "md" }) {
  const box = size === "md" ? "w-12 h-12" : "w-11 h-11";
  return (
    <div className={`${box} rounded-card flex items-center justify-center shrink-0`} style={{ background: colour }} aria-hidden>
      <span className="text-white font-extrabold text-base">{emblem ?? name.slice(0, 2).toUpperCase()}</span>
    </div>
  );
}

export function NearbyCircleCard({ data }: { data: NearbyCircleData }) {
  if (data.tier === "invite_only") return <InviteOnlyCircleCard data={data} />;
  return <OpenCircleCard data={data} />;
}

/** OPEN tier: the directory card whose primary affordance is a circle-knock. */
function OpenCircleCard({ data }: { data: NearbyCircleData }) {
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
        <EmblemMark colour={colour} emblem={data.emblem} name={data.name} size="sm" />
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
          <Meta>knocked, waiting on the organiser</Meta>
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
          <EmblemMark colour={colour} emblem={data.emblem} name={data.name} size="md" />
          <p className="text-cu-body text-ink flex-1">{vibe}</p>
        </div>
        <PreviewFacts data={data} />
        <p className="text-cu-meta text-ink-muted mt-4">
          Only the organiser sees your knock, nothing about this Circle is shared until you&apos;re in.
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

/**
 * INVITE-ONLY tier: the Circle is visible near you, but joining is by invite
 * link, so there is no circle-knock affordance. What a viewer CAN do is ask
 * into one of its open games (the same session-ask The Board uses), because
 * those games are already public there under this Circle's name. The neutral
 * mono chip states the fact ("Invite only") without a warning tint, and the
 * clarity line spells the functionality out so it can't be mistaken for a
 * locked door.
 */
function InviteOnlyCircleCard({ data }: { data: NearbyCircleData }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const colour = data.colour ?? circleColorFor(data.circleId);
  const vibe = data.vibeLine ?? "A padel Circle near your patch.";

  const boardProps = (g: NearbyCircleOpenGameData): BoardCardProps => ({
    sessionId: g.sessionId,
    circleName: data.name,
    venueName: g.venueName,
    whenLabel: whenLabelFor(g.startsAtMs),
    distanceLabel: g.distanceLabel,
    levelLine: g.levelLine,
    slotsOpen: g.slotsOpen,
    initialPending: g.viewerHasPendingKnock,
  });

  return (
    <Card className="flex flex-col gap-3">
      <button type="button" onClick={() => setPreviewOpen(true)} className="flex items-start gap-3 text-left w-full">
        <EmblemMark colour={colour} emblem={data.emblem} name={data.name} size="sm" />
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

      <div className="flex flex-col gap-1.5">
        <span className="self-start rounded-chip inline-flex items-center px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide bg-ink-hairline-2 text-ink-muted">
          Invite only
        </span>
        <Meta as="p">Membership is by invite. Their open games still take asks.</Meta>
      </div>

      {data.openGames.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Meta as="p">
            {data.openGames.length} game{data.openGames.length === 1 ? "" : "s"} with a spot this week
          </Meta>
          {data.openGames.map((g) => (
            <BoardCard key={g.sessionId} {...boardProps(g)} />
          ))}
        </div>
      ) : (
        <Meta as="p">No open games with a spot right now.</Meta>
      )}

      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={data.name}>
        <div className="flex items-center gap-3">
          <EmblemMark colour={colour} emblem={data.emblem} name={data.name} size="md" />
          <p className="text-cu-body text-ink flex-1">{vibe}</p>
        </div>
        <PreviewFacts data={data} />
        <p className="text-cu-meta text-ink-muted mt-4">
          Membership is by invite link. You can still ask into one of their open games above, the organiser decides.
        </p>
      </Sheet>
    </Card>
  );
}

/** The aggregate, coordinate-free facts both tiers show in the preview sheet. */
function PreviewFacts({ data }: { data: NearbyCircleData }) {
  return (
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
  );
}
