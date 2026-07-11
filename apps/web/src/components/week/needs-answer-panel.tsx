"use client";

import Link from "next/link";
import { Avatar, Button, DashedSlot, Meta } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";
import { useRsvp } from "./use-rsvp";
import { whenLabel } from "./format";

export interface WeekNeedsAnswer {
  sessionId: string;
  circleName: string;
  venueName: string | null;
  startsAt: number;
  timezone: string;
  slots: number;
  confirmed: { userId: string; displayName: string; avatarUrl: string | null }[];
}

type Viewer = { userId: string; displayName: string; avatarUrl: string | null };

/** "Kav & Mags are in" — first names, the prototype's convention. */
function namesLine(confirmed: { displayName: string }[]): string {
  const names = confirmed.map((p) => p.displayName.split(" ")[0]);
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is in`;
  const last = names[names.length - 1];
  return `${names.slice(0, -1).join(", ")} & ${last} are in`;
}

/**
 * The wide surface's one surface-feature panel (design "Desktop · Your week",
 * NEEDS YOUR ANSWER). Its single coral action is "I'm in"; "Can't" is the
 * quiet counterpart. Same RSVP endpoint the phone home uses (useRsvp) — no new
 * mutation. Bespoke to the wide layout: the phone renders the terser
 * NeedsAnswerCard, this is the desk restatement with the "You make it a four"
 * line the design leads with.
 */
export function NeedsAnswerPanel({ session, viewer }: { session: WeekNeedsAnswer; viewer: Viewer }) {
  const { respond, pending, error, answered } = useRsvp(session.sessionId);
  const optimisticIn = answered === "in";

  const displayConfirmed = optimisticIn ? [...session.confirmed, viewer] : session.confirmed;
  const shown = displayConfirmed.slice(0, 3);
  const spotsToFill = Math.max(session.slots - displayConfirmed.length, 0);
  const names = namesLine(session.confirmed);
  const fillLine =
    spotsToFill === 1 ? `${names}. You make it a four` : `${names}, ${spotsToFill} spot${spotsToFill === 1 ? "" : "s"} to fill`;

  return (
    <div className="rounded-card bg-surface-feature border border-ink-hairline-2 p-5">
      <div className="flex items-center gap-2">
        <span className="w-[7px] h-[7px] rounded-full bg-action shrink-0" aria-hidden />
        <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-action-on-feature-label uppercase truncate">
          Needs your answer · {session.circleName}
        </p>
        <span className="flex-1" />
        <Link href={`/games/${session.sessionId}`} className="text-[12px] font-bold text-action-on-feature-link whitespace-nowrap">
          View game →
        </Link>
      </div>

      <p className="text-[22px] leading-[1.2] font-extrabold text-ink-on-feature mt-3">
        {whenLabel(session.startsAt, session.timezone)}
        {session.venueName ? ` · ${session.venueName}` : ""}
      </p>

      {displayConfirmed.length > 0 && (
        <div className="flex items-center gap-2.5 mt-3.5">
          <div className="flex items-center">
            {shown.map((p, i) => (
              <Avatar
                key={p.userId}
                src={p.avatarUrl}
                name={p.displayName}
                size="sm"
                ring="surface-feature"
                overlap={i > 0}
                className={optimisticIn && p.userId === viewer.userId ? "animate-cu-arrive" : ""}
              />
            ))}
            {Array.from({ length: spotsToFill }, (_, i) => (
              <DashedSlot key={`open-${i}`} size="sm" label="" overlap={shown.length > 0 || i > 0} />
            ))}
          </div>
          <span className="text-[12.5px] font-medium text-ink-on-feature-muted">
            {optimisticIn ? "You're in ✓ · game on" : fillLine}
          </span>
        </div>
      )}

      {error && (
        <Meta as="p" tone="loss" onFeature className="mt-2">
          {errorCopy(error)}
        </Meta>
      )}

      <div className="flex gap-2.5 mt-4">
        {optimisticIn ? (
          <Button
            variant="strong"
            size="lg"
            onFeature
            disabled={pending}
            onClick={() => respond("out")}
            style={{ background: "var(--color-win)", color: "var(--color-action-contrast)" }}
            className="flex-1"
          >
            You&apos;re in ✓ · game on
          </Button>
        ) : (
          <>
            <Button variant="primary" size="lg" onFeature disabled={pending} onClick={() => respond("in")} className="flex-[2]">
              I&apos;m in
            </Button>
            <Button variant="destructiveQuiet" size="lg" onFeature disabled={pending} onClick={() => respond("out")} className="flex-1">
              Can&apos;t
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
