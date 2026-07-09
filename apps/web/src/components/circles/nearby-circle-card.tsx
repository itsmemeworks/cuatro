"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Meta, Fact, Sheet, Button, Avatar, AvatarStack, InfoTerm } from "@/components/ui";
import { BoardCard, type BoardCardProps } from "@/components/games/board-card";
import { circleColorFor, formatGlass } from "@/lib/design";
import { CircleCardArt } from "./circle-header";

/** Serializable mirror of server/open-door.ts's CirclePreviewMember. */
export interface CirclePreviewMemberData {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  role: "organiser" | "member";
}

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
  /** Organiser's explicit curated-header key; null falls back to the deterministic auto-assign. */
  headerImage: string | null;
  tier: "open" | "invite_only";
  venueArea: string | null;
  distanceLabel: string;
  cadence: string | null;
  memberCount: number;
  level: { min: number; max: number } | null;
  unratedCount: number;
  members: CirclePreviewMemberData[];
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
  circle_full: "That Circle is at its limit, so no one new can join right now.",
  network_error: "Couldn't reach the server, check your connection and try again.",
  something_went_wrong: "That didn't go through. Give it another tap.",
};

/** The Glass range as text, en-dash for a true range (a legitimate dash use). */
function glassRangeText(level: NearbyCircleData["level"]): string | null {
  if (!level) return null;
  return level.min === level.max ? level.min.toFixed(2) : `${level.min.toFixed(2)}–${level.max.toFixed(2)}`;
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

/**
 * The Glass range, promoted to a first-class fact on every discovery card:
 * you browse Circles to find one at your level, so level-fit has to read at a
 * glance. Big mono range in a tinted pill, with the "still placing" count kept
 * honest beside it. `showInfo` renders the Glass explainer once per screen.
 */
function GlassBand({ data, showInfo }: { data: NearbyCircleData; showInfo: boolean }) {
  const range = glassRangeText(data.level);
  return (
    <div className="flex items-center justify-between gap-3 rounded-button bg-ink-hairline-1 px-3.5 py-2.5">
      <span className="text-cu-meta uppercase tracking-[0.12em] text-ink-muted">
        {showInfo ? <InfoTerm term="glass" label="Glass" /> : "Glass"} level
      </span>
      <div className="text-right">
        {range ? (
          <Fact size="lg" weight="bold">
            {range}
          </Fact>
        ) : (
          <Meta tone="neutral">levels forming</Meta>
        )}
        {data.unratedCount > 0 && (
          <Meta as="p" className="mt-0.5">
            {data.unratedCount} still placing
          </Meta>
        )}
      </div>
    </div>
  );
}

/** Overlapping faces + count, from the pre-join roster (guests already excluded server-side). */
function MembersRow({ data }: { data: NearbyCircleData }) {
  return (
    <div className="flex items-center gap-2.5">
      {data.members.length > 0 && (
        <AvatarStack
          people={data.members.map((m) => ({ src: m.avatarUrl, name: m.displayName }))}
          size="sm"
          max={5}
        />
      )}
      <Meta>
        {data.memberCount} member{data.memberCount === 1 ? "" : "s"}
      </Meta>
    </div>
  );
}

/** The pre-join roster: avatar, name, Glass. The reason people browse — level fit. */
function MembersPreviewList({ members }: { members: CirclePreviewMemberData[] }) {
  if (members.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-1">
      <Meta as="p" className="mb-1">
        Who plays here
      </Meta>
      {members.map((m) => (
        <Link key={m.userId} href={`/players/${m.userId}`} className="flex items-center gap-3 py-1.5 rounded-button transition-cu-state active:bg-ink-hairline-1">
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
  );
}

export function NearbyCircleCard({ data, showGlassInfo = false }: { data: NearbyCircleData; showGlassInfo?: boolean }) {
  if (data.tier === "invite_only") return <InviteOnlyCircleCard data={data} showGlassInfo={showGlassInfo} />;
  return <OpenCircleCard data={data} showGlassInfo={showGlassInfo} />;
}

/** OPEN tier: the directory card whose primary affordance is a circle-knock. */
function OpenCircleCard({ data, showGlassInfo }: { data: NearbyCircleData; showGlassInfo: boolean }) {
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
    <Card padded={false} className="overflow-hidden">
      <button type="button" onClick={() => setPreviewOpen(true)} className="block w-full text-left">
        <CircleCardArt circleId={data.circleId} headerImage={data.headerImage} colour={colour} emblem={data.emblem} name={data.name} />
      </button>

      <div className="p-4 flex flex-col gap-3">
        <p className="text-cu-secondary text-ink-muted line-clamp-2">{vibe}</p>

        <GlassBand data={data} showInfo={showGlassInfo} />

        <div className="flex items-center justify-between gap-3">
          <Meta>{data.venueArea ?? "Nearby"} · {data.distanceLabel}</Meta>
          <MembersRow data={data} />
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
      </div>

      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={data.name}>
        <p className="text-cu-body text-ink">{vibe}</p>
        <div className="mt-4">
          <GlassBand data={data} showInfo={false} />
        </div>
        <PreviewFacts data={data} />
        <MembersPreviewList members={data.members} />
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
function InviteOnlyCircleCard({ data, showGlassInfo }: { data: NearbyCircleData; showGlassInfo: boolean }) {
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
    <Card padded={false} className="overflow-hidden">
      <button type="button" onClick={() => setPreviewOpen(true)} className="block w-full text-left">
        <CircleCardArt circleId={data.circleId} headerImage={data.headerImage} colour={colour} emblem={data.emblem} name={data.name} />
      </button>

      <div className="p-4 flex flex-col gap-3">
        <p className="text-cu-secondary text-ink-muted line-clamp-2">{vibe}</p>

        <GlassBand data={data} showInfo={showGlassInfo} />

        <div className="flex items-center justify-between gap-3">
          <Meta>{data.venueArea ?? "Nearby"} · {data.distanceLabel}</Meta>
          <MembersRow data={data} />
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
      </div>

      <Sheet open={previewOpen} onClose={() => setPreviewOpen(false)} title={data.name}>
        <p className="text-cu-body text-ink">{vibe}</p>
        <div className="mt-4">
          <GlassBand data={data} showInfo={false} />
        </div>
        <PreviewFacts data={data} />
        <MembersPreviewList members={data.members} />
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
        <Meta as="dt">Members</Meta>
        <Meta as="dd" tone="neutral">{data.memberCount}</Meta>
      </div>
    </dl>
  );
}
