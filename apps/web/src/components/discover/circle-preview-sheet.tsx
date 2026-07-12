"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Fact, Meta, PendingSpinner, Sheet } from "@/components/ui";
import { formatGlass } from "@/lib/design";

/**
 * The Circle's PUBLIC pre-join preview sheet — one body, three doors in:
 *
 *  - `CirclePreviewBody`   — the presentational sheet content (vibe, the
 *    public facts, who plays here, the knock affordance). Extracted from the
 *    Discover circle card so every surface renders the SAME preview.
 *  - `CirclePreviewSheet`  — a self-contained Sheet that lazily fetches
 *    /api/circles/[id]/preview when opened. For surfaces that only know a
 *    circleId (Board cards, Discover game cards, an outsider's game page).
 *  - `CirclePreviewTrigger`— a button + sheet pair, so SERVER components (the
 *    wide game detail header) can hand a non-member a tappable circle name.
 *
 * Aggregate/public facts only (server/open-door.ts's privacy contract); the
 * knock fires the same /api/knocks/circle endpoint the Open Door cards use.
 */

// Human copy for the circle-knock error codes — matches the phone Open Door
// card (components/circles/nearby-circle-card.tsx). Kept out of the shared
// lib/error-copy.ts because these codes are specific to this flow.
export const KNOCK_ERROR_COPY: Record<string, string> = {
  door_closed: "This Circle just closed its door, try another one near you.",
  already_member: "You're already in this Circle.",
  already_knocked: "You've already knocked here, the organiser will get back to you.",
  is_guest: "Claim your account first, then you can knock.",
  circle_not_found: "That Circle isn't around any more.",
  circle_full: "That Circle is at its limit, so no one new can join right now.",
  network_error: "Couldn't reach the server, check your connection and try again.",
  something_went_wrong: "That didn't go through. Give it another tap.",
};

export function knockErrorCopy(code: string | null | undefined): string {
  return KNOCK_ERROR_COPY[code ?? ""] ?? KNOCK_ERROR_COPY.something_went_wrong;
}

export interface CirclePreviewMemberData {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  role: "organiser" | "member";
}

/** Client mirror of the public preview the API route serves (aggregate facts only). */
export interface CirclePreviewData {
  circleId: string;
  name: string;
  vibeLine: string | null;
  level: { min: number; max: number } | null;
  venueArea: string | null;
  distanceLabel: string | null;
  cadence: string | null;
  memberCount: number;
  members: CirclePreviewMemberData[];
  /** Door open → the knock affordance renders; invite-only Circles get the quiet explainer instead. */
  openDoor: boolean;
  hasPendingKnock: boolean;
}

/** "Level 3.80–4.60 · rotating pairs" — level first, then the Circle's own vibe line. */
export function circleVibeLine(level: CirclePreviewData["level"], vibeLine: string | null): string {
  const range = level ? (level.min === level.max ? level.min.toFixed(2) : `${level.min.toFixed(2)}–${level.max.toFixed(2)}`) : null;
  return [range ? `Level ${range}` : "Levels forming", vibeLine].filter(Boolean).join(" · ");
}

/** "12 members · Tuesdays 20:00" — the mono fact under the name. */
export function circleSubline(memberCount: number, cadence: string | null): string {
  return [`${memberCount} member${memberCount === 1 ? "" : "s"}`, cadence].filter(Boolean).join(" · ");
}

export interface KnockControl {
  pending: boolean;
  busy: boolean;
  /** Raw error CODE (mapped through KNOCK_ERROR_COPY here); null when clean. */
  error: string | null;
  onKnock: () => void;
  onWithdraw: () => void;
}

const KNOCK_BUTTON_CLASS =
  "w-full cursor-pointer rounded-button border border-ink-hairline-4 text-ink font-bold text-[12px] text-center py-2.5 transition-cu-state hover:bg-ink-hairline-1 active:opacity-80 disabled:opacity-50";

/**
 * The sheet CONTENT (render inside a <Sheet>): vibe, the public facts, who
 * plays here, then the knock affordance. `knock` is the caller's control so a
 * card and its sheet can share one pending state; pass null while loading.
 */
export function CirclePreviewBody({ data, knock }: { data: CirclePreviewData; knock: KnockControl | null }) {
  const vibe = circleVibeLine(data.level, data.vibeLine);
  const subline = circleSubline(data.memberCount, data.cadence);

  return (
    <>
      <p className="text-cu-body text-ink">{vibe}</p>
      <div className="mt-4 flex flex-col gap-1">
        <Meta as="p">
          {data.venueArea ?? "Nearby"}
          {data.distanceLabel ? ` · ${data.distanceLabel}` : ""}
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
      {data.openDoor ? (
        <>
          <p className="text-cu-meta text-ink-muted mt-4">
            Only the organiser sees your knock, nothing about this Circle is shared until you&apos;re in.
          </p>
          {knock && (
            <div className="mt-4">
              {knock.pending ? (
                <button type="button" onClick={knock.onWithdraw} disabled={knock.busy} className={KNOCK_BUTTON_CLASS}>
                  {knock.busy ? <PendingSpinner /> : null} Withdraw knock
                </button>
              ) : (
                <button type="button" onClick={knock.onKnock} disabled={knock.busy} className={KNOCK_BUTTON_CLASS}>
                  {knock.busy ? <PendingSpinner /> : null} Ask to join
                </button>
              )}
              {knock.error && (
                <Meta as="p" tone="action" className="mt-2">
                  {knockErrorCopy(knock.error)}
                </Meta>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-cu-meta text-ink-muted mt-4">
          This Circle joins by invite. Its open games still take asks, so look for them on Discover.
        </p>
      )}
    </>
  );
}

/**
 * Self-contained preview sheet for surfaces that only know a circleId: fetches
 * the public preview on first open, manages its own knock state (same
 * /api/knocks/circle endpoint as the Discover circle card).
 */
export function CirclePreviewSheet({
  circleId,
  circleName,
  open,
  onClose,
}: {
  circleId: string;
  circleName: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<CirclePreviewData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || data || loadFailed) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/circles/${encodeURIComponent(circleId)}/preview`);
        const body = (await res.json().catch(() => null)) as { ok?: boolean; preview?: CirclePreviewData } | null;
        if (cancelled) return;
        if (res.ok && body?.ok && body.preview) {
          setData(body.preview);
          setPending(body.preview.hasPendingKnock);
        } else {
          setLoadFailed(true);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, data, loadFailed, circleId]);

  async function knock() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/knocks/circle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circleId }),
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
        body: JSON.stringify({ circleId }),
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
    <Sheet open={open} onClose={onClose} title={circleName}>
      {data ? (
        <CirclePreviewBody data={data} knock={{ pending, busy, error, onKnock: knock, onWithdraw: withdraw }} />
      ) : loadFailed ? (
        <p className="text-cu-body text-ink-muted">This Circle keeps its door and its details to itself.</p>
      ) : (
        <div className="flex items-center gap-2 py-2 text-ink-muted">
          <PendingSpinner /> <Meta>having a look</Meta>
        </div>
      )}
    </Sheet>
  );
}

/**
 * A button + preview sheet pair so a SERVER component (the wide game detail
 * header) can render a tappable circle identity for a non-member. `children`
 * is the visible identity row (emblem + name), rendered inside the button.
 */
export function CirclePreviewTrigger({
  circleId,
  circleName,
  className = "",
  children,
}: {
  circleId: string;
  circleName: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Have a look at ${circleName}`}
        className={`cursor-pointer transition-cu-state hover:text-ink ${className}`}
      >
        {children}
      </button>
      <CirclePreviewSheet circleId={circleId} circleName={circleName} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
