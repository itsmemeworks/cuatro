"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Button, Meta } from "@/components/ui";
import { saveDoorSettings } from "@/app/(app)/circles/[id]/door-actions";
import { removeMemberAction } from "@/app/(app)/circles/[id]/lifecycle-actions";
import type { MemberListItem } from "@/components/circles/member-list";
import type { KnockPanelItem } from "@/components/circles/knock-panel";
import type { SettingsStandingGameView } from "@/app/(app)/circles/[id]/load-circle";
import { BOOKING_PLATFORMS, bookingPlatform } from "@/lib/booking";
import { formatMoneyWhole } from "@/components/tab/money";
import { formatGlass } from "@/lib/design";

/*
 * The wide Circle · Settings surface (design/CUATRO-Web-LATEST.dc.html,
 * "Circle · Settings", organiser only). Two columns: visibility tiers +
 * members + game-type default on the left; the join-request queue and the
 * Standing Game cards (incl. the issue #21 MONEY opt-in state) on the right.
 * All writes go through the same actions the phone settings tab uses
 * (saveDoorSettings / removeMemberAction / the knocks API), so the two
 * form factors can never disagree about what a setting does.
 * `hidden min-[900px]:block` at the call site — never rendered on phone.
 */

type Tier = "open" | "invite_only" | "private";

const TIERS: { id: Tier; name: string; line: string }[] = [
  { id: "open", name: "Open", line: "anyone nearby can ask, you approve" },
  { id: "invite_only", name: "Invite only", line: "link or QR only, invisible to Discover asks" },
  { id: "private", name: "Private", line: "unlisted everywhere, members only" },
];

/** The two flags collapse to a tier exactly as door-controls.tsx's tierFor. */
function tierFor(openDoor: boolean, boardEnabled: boolean): Tier {
  if (openDoor) return "open";
  return boardEnabled ? "invite_only" : "private";
}

/** ...and a tier expands back to both flags, so picking one is unambiguous. */
const FLAGS_FOR_TIER: Record<Tier, { openDoor: boolean; boardEnabled: boolean }> = {
  open: { openDoor: true, boardEnabled: true },
  invite_only: { openDoor: false, boardEnabled: true },
  private: { openDoor: false, boardEnabled: false },
};

const WEEKDAY_PLURALS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

/** "20:00" -> "8pm" — same convention as the standing game editor page. */
function formatStartTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const period = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return Number(mStr) === 0 ? `${h12}${period}` : `${h12}:${mStr}${period}`;
}

function RadioDot({ active, size = 16 }: { active: boolean; size?: number }) {
  return (
    <span
      aria-hidden
      className="rounded-full box-border flex-none"
      style={{
        width: size,
        height: size,
        border: active ? "5px solid var(--color-action)" : "1.5px solid var(--color-ink-hairline-4)",
      }}
    />
  );
}

function CardShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-surface border border-ink-hairline-1 rounded-[20px] overflow-hidden ${className}`}>{children}</div>;
}

function CardHeader({ children, right, tinted = false }: { children: ReactNode; right?: ReactNode; tinted?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-[18px] py-[11px] ${tinted ? "bg-action/[.07]" : "bg-ink-hairline-1"}`}>
      <span className={`font-sans font-extrabold text-[10px] tracking-[0.14em] ${tinted ? "text-action-strong" : "text-ink-muted"}`}>
        {children}
      </span>
      {right}
    </div>
  );
}

/** The knock queue's facts line: "Glass 4.41 · conf 63% · shows up 92%", nulls dropped honestly. */
function knockFacts(k: KnockPanelItem): string {
  const parts: string[] = [];
  parts.push(k.rating != null ? `Glass ${formatGlass(k.rating)} · conf ${Math.round(k.confidence * 100)}%` : "not rated yet");
  if (k.reliability != null) parts.push(`shows up ${Math.round(k.reliability * 100)}%`);
  if (k.distanceLabel) parts.push(k.distanceLabel);
  return parts.join(" · ");
}

/** The compact standing-game row's mono facts, e.g. "Rotation on · limited · friendlies · booked on PT". */
function standingGameFacts(sg: SettingsStandingGameView): string {
  const parts: string[] = [sg.rotationEnabled ? `Rotation on · ${sg.rotationMode}` : "first come"];
  if (sg.gameType === "friendly") parts.push("friendlies");
  if (sg.moneyOptIn?.kind === "booking") {
    const p = bookingPlatform(sg.moneyOptIn.booking.platform);
    if (p) parts.push(`booked on ${p.tile === "··" ? p.label.toLowerCase() : p.tile}`);
  } else if (sg.moneyOptIn?.kind === "cost") {
    parts.push(`${formatMoneyWhole(sg.moneyOptIn.amountMinor, sg.moneyOptIn.currency)} on the Tab`);
  }
  return parts.join(" · ");
}

export function WideSettings({
  circleId,
  circleName,
  initialOpenDoor,
  initialBoardEnabled,
  initialDefaultGameType,
  members,
  currentUserId,
  knocks,
  standingGames,
  /** The EditCircleSheet instance (trigger + sheet) — composed by the caller, which owns all its props. */
  editCircleSlot,
}: {
  circleId: string;
  circleName: string;
  initialOpenDoor: boolean;
  initialBoardEnabled: boolean;
  initialDefaultGameType: "competitive" | "friendly";
  members: MemberListItem[];
  currentUserId: string;
  knocks: KnockPanelItem[];
  standingGames: SettingsStandingGameView[];
  editCircleSlot?: ReactNode;
}) {
  const router = useRouter();
  const [flags, setFlags] = useState({ openDoor: initialOpenDoor, boardEnabled: initialBoardEnabled });
  const [gameType, setGameType] = useState(initialDefaultGameType);
  const [confirmingRemove, setConfirmingRemove] = useState<string | null>(null);
  const [busyKnock, setBusyKnock] = useState<{ id: string; action: "accept" | "decline" } | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  const tier = tierFor(flags.openDoor, flags.boardEnabled);

  function pickTier(next: Tier) {
    if (next === tier || pending) return;
    const prev = flags;
    const nextFlags = FLAGS_FOR_TIER[next];
    setFlags(nextFlags);
    setError(false);
    startTransition(async () => {
      const res = await saveDoorSettings(circleId, nextFlags);
      if (!res.ok) {
        setFlags(prev);
        setError(true);
      }
    });
  }

  function pickGameType(next: "competitive" | "friendly") {
    if (next === gameType || pending) return;
    const prev = gameType;
    setGameType(next);
    setError(false);
    startTransition(async () => {
      const res = await saveDoorSettings(circleId, { defaultGameType: next });
      if (!res.ok) {
        setGameType(prev);
        setError(true);
      }
    });
  }

  function removeMember(userId: string) {
    setError(false);
    startTransition(async () => {
      const res = await removeMemberAction(circleId, userId);
      if (res.ok) {
        setConfirmingRemove(null);
        router.refresh();
      } else {
        setError(true);
      }
    });
  }

  async function decideKnock(knockId: string, action: "accept" | "decline") {
    setBusyKnock({ id: knockId, action });
    setError(false);
    try {
      const res = await fetch(`/api/knocks/circle/${knockId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusyKnock(null);
    }
  }

  const [primaryGame, ...restGames] = standingGames;

  return (
    <div>
      {/* Header */}
      <div className="flex items-end gap-3.5">
        <div className="flex-1 min-w-0">
          <h1 className="font-sans font-extrabold text-[24px] leading-none text-ink">Circle settings</h1>
          <p className="font-sans text-[12px] text-ink-muted mt-1">{circleName} · organiser only</p>
        </div>
        {editCircleSlot != null && <div className="w-[120px] flex-none">{editCircleSlot}</div>}
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4 items-start">
        {/* ===== left column ===== */}
        <div className="min-w-0">
          <CardShell>
            <CardHeader>VISIBILITY</CardHeader>
            {TIERS.map((t, i) => {
              const active = t.id === tier;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTier(t.id)}
                  disabled={pending}
                  aria-pressed={active}
                  className={`w-full flex items-center gap-[11px] px-[18px] py-3 text-left transition-cu-state hover:bg-ink-hairline-1 ${
                    i < TIERS.length - 1 ? "border-b border-ink-hairline-1" : ""
                  }`}
                >
                  <RadioDot active={active} />
                  <span className="flex-1 min-w-0">
                    <span className={`block font-sans font-bold text-[12.5px] ${active ? "text-ink" : "text-ink/75"}`}>{t.name}</span>
                    <span className="block font-mono text-[10px] text-ink-muted mt-0.5">{t.line}</span>
                  </span>
                </button>
              );
            })}
          </CardShell>

          <CardShell className="mt-3.5">
            <CardHeader>MEMBERS · {members.length}</CardHeader>
            {members.map((m, i) => {
              const isYou = m.userId === currentUserId;
              const confirming = confirmingRemove === m.userId;
              return (
                <div
                  key={m.userId}
                  className={`flex items-center gap-2.5 px-[18px] py-2.5 ${i < members.length - 1 ? "border-b border-ink-hairline-1" : ""}`}
                >
                  <Avatar src={m.avatarUrl} name={m.displayName} size="sm" />
                  <span className="font-sans font-bold text-[12px] text-ink flex-1 min-w-0 truncate">{m.displayName}</span>
                  {m.role === "organiser" ? (
                    <span className="bg-ink-hairline-2 text-ink rounded-full px-2 py-0.5 font-sans font-bold text-[10px] tracking-[0.06em]">
                      ORGANISER
                    </span>
                  ) : confirming ? (
                    <span className="flex items-center gap-2.5">
                      <Meta as="span">sure?</Meta>
                      <button
                        type="button"
                        onClick={() => removeMember(m.userId)}
                        disabled={pending}
                        className="font-sans font-bold text-[10.5px] text-loss"
                      >
                        {pending ? "Removing…" : "Remove"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingRemove(null)}
                        disabled={pending}
                        className="font-sans font-semibold text-[10.5px] text-ink-muted"
                      >
                        Keep
                      </button>
                    </span>
                  ) : isYou ? (
                    <span className="font-sans text-[10px] text-action-strong">· you</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingRemove(m.userId)}
                      className="font-sans font-semibold text-[10.5px] text-ink-muted transition-cu-state hover:text-ink"
                    >
                      Remove
                    </button>
                  )}
                </div>
              );
            })}
          </CardShell>

          <div className="mt-3.5 bg-surface border border-ink-hairline-1 rounded-[20px] px-[18px] py-3.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-sans font-extrabold text-[10px] tracking-[0.14em] text-ink-muted">GAME TYPE DEFAULT</div>
              <div className="font-mono text-[10px] text-ink-muted mt-1">snapshotted onto every match at record time</div>
            </div>
            <div className="flex gap-[3px] bg-ground border border-ink-hairline-2 rounded-full p-[3px] flex-none">
              {(
                [
                  { id: "competitive", label: "Rated" },
                  { id: "friendly", label: "Friendlies" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => pickGameType(opt.id)}
                  disabled={pending}
                  aria-pressed={gameType === opt.id}
                  className={`rounded-full px-3 py-1.5 font-sans font-bold text-[11px] transition-cu-state ${
                    gameType === opt.id ? "bg-ink text-ground" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ===== right column ===== */}
        <div className="min-w-0">
          <CardShell>
            <CardHeader tinted right={<span className="font-mono text-[10px] text-ink-muted">Open circles only</span>}>
              JOIN REQUESTS · {knocks.length}
            </CardHeader>
            {knocks.length === 0 ? (
              <p className="px-[18px] py-4 font-mono text-[10.5px] text-ink-muted">
                {tier === "open" ? "no one at the door right now" : "open the Circle and nearby players can ask to join"}
              </p>
            ) : (
              knocks.map((k, i) => (
                <div key={k.knockId} className={`px-[18px] py-[13px] ${i < knocks.length - 1 ? "border-b border-ink-hairline-1" : ""}`}>
                  <div className="flex items-center gap-[11px]">
                    <Avatar src={k.avatarUrl} name={k.displayName} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="font-sans font-bold text-[13px] text-ink truncate">{k.displayName}</div>
                      <div className="font-mono text-[10px] text-ink-muted mt-0.5 truncate">{knockFacts(k)}</div>
                    </div>
                    <Button
                      variant="quiet"
                      onClick={() => decideKnock(k.knockId, "accept")}
                      pending={busyKnock?.id === k.knockId && busyKnock.action === "accept"}
                      disabled={busyKnock?.id === k.knockId}
                      className="rounded-full text-[11px]"
                    >
                      Approve ✓
                    </Button>
                    <button
                      type="button"
                      onClick={() => decideKnock(k.knockId, "decline")}
                      disabled={busyKnock?.id === k.knockId}
                      className="font-sans font-semibold text-[11px] text-ink-muted transition-cu-state hover:text-ink disabled:opacity-50"
                    >
                      {busyKnock?.id === k.knockId && busyKnock.action === "decline" ? "Declining…" : "Decline"}
                    </button>
                  </div>
                  {k.message && <p className="font-mono text-[10px] text-ink-muted mt-2">&ldquo;{k.message}&rdquo;</p>}
                </div>
              ))
            )}
          </CardShell>

          {primaryGame ? (
            <CardShell className="mt-3.5">
              <CardHeader
                right={
                  primaryGame.active ? (
                    <span className="bg-win-tint text-win rounded-full px-2.5 py-[3px] font-sans font-bold text-[10px]">Active</span>
                  ) : (
                    <span className="bg-ink-hairline-2 text-ink-muted rounded-full px-2.5 py-[3px] font-sans font-bold text-[10px]">Paused</span>
                  )
                }
              >
                STANDING GAME · {WEEKDAY_PLURALS[primaryGame.weekday].toUpperCase()} {formatStartTime(primaryGame.startTime).toUpperCase()}
              </CardHeader>

              <div className="grid grid-cols-2 gap-2.5 px-[18px] py-3.5">
                {(
                  [
                    { label: "weekday", value: WEEKDAY_PLURALS[primaryGame.weekday].replace(/s$/, "") },
                    { label: "start", value: primaryGame.startTime },
                    { label: "duration", value: `${primaryGame.durationMinutes} min` },
                    { label: "slots", value: String(primaryGame.slots) },
                  ] as const
                ).map((f) => (
                  <div key={f.label} className="bg-ground border border-ink-hairline-2 rounded-[11px] px-3 py-[9px]">
                    <div className="font-mono text-[10px] text-ink-muted">{f.label}</div>
                    <div className="font-sans font-bold text-[12.5px] text-ink mt-0.5">{f.value}</div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 px-[18px] pb-3.5">
                <div className="flex-1 min-w-0">
                  <div className="font-sans font-bold text-[12.5px] text-ink">The Rotation</div>
                  <div className="font-mono text-[10px] text-ink-muted mt-0.5">
                    {primaryGame.rotationEnabled
                      ? "on: CUATRO picks a fair four and rotates who sits out"
                      : "off: first come holds a slot, reserves auto-promote"}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-ink-muted/75">
                  cutoff {primaryGame.rotationCutoffHours}h · {primaryGame.rotationMode}
                </span>
                <span
                  aria-hidden
                  className={`relative w-[38px] h-[22px] rounded-full flex-none ${primaryGame.rotationEnabled ? "bg-action" : "bg-ink-hairline-2"}`}
                >
                  <span
                    className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white ${primaryGame.rotationEnabled ? "right-0.5" : "left-0.5"}`}
                  />
                </span>
              </div>

              {/* MONEY (issue #21): the current opt-in state, read here, edited on the game page. */}
              <div className="border-t border-ink-hairline-1 px-[18px] pt-3 pb-3.5">
                <div className="flex items-baseline gap-2">
                  <span className="font-sans font-extrabold text-[10px] tracking-[0.14em] text-ink-muted">MONEY</span>
                  <span className="font-mono text-[10px] text-ink-muted/75">optional. Most games carry none, pick either or neither</span>
                </div>

                <div className="flex items-start gap-2 mt-[11px]">
                  <RadioDot active={primaryGame.moneyOptIn?.kind === "booking"} size={15} />
                  <span
                    className={`font-sans font-bold text-[12px] w-[104px] ${primaryGame.moneyOptIn?.kind === "booking" ? "text-ink" : "text-ink/75"}`}
                  >
                    Booked on
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3.5 flex-wrap">
                      {BOOKING_PLATFORMS.slice(0, 4).map((p) => {
                        const chosen = primaryGame.moneyOptIn?.kind === "booking" && primaryGame.moneyOptIn.booking.platform === p.id;
                        return (
                          <span key={p.id} className="inline-flex items-center gap-1.5">
                            <span
                              className={`w-6 h-6 rounded-[8px] flex items-center justify-center font-sans font-extrabold text-[10px] ${
                                chosen ? "bg-ink text-ground" : "bg-ink-hairline-2 text-ink/75"
                              }`}
                            >
                              {p.tile}
                            </span>
                            <span className={`font-mono text-[10px] ${chosen ? "text-ink" : "text-ink-muted"}`}>{p.label}</span>
                          </span>
                        );
                      })}
                    </div>
                    <div className="font-mono text-[10px] text-ink-muted/75 mt-[7px]">
                      {primaryGame.moneyOptIn?.kind === "booking" && primaryGame.moneyOptIn.booking.url ? (
                        <a
                          href={primaryGame.moneyOptIn.booking.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-ink"
                        >
                          pay on {bookingPlatform(primaryGame.moneyOptIn.booking.platform)?.label} ↗
                        </a>
                      ) : (
                        "club site · other · + paste a booking link"
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-[9px]">
                  <RadioDot active={primaryGame.moneyOptIn?.kind === "cost"} size={15} />
                  <span
                    className={`font-sans font-bold text-[12px] w-[104px] ${primaryGame.moneyOptIn?.kind === "cost" ? "text-ink" : "text-ink/75"}`}
                  >
                    Goes on the Tab
                  </span>
                  {primaryGame.moneyOptIn?.kind === "cost" ? (
                    <>
                      <span className="bg-ground border border-ink-hairline-2 rounded-[9px] px-[11px] py-[5px] font-sans font-bold text-[12px] text-ink">
                        {formatMoneyWhole(primaryGame.moneyOptIn.amountMinor, primaryGame.moneyOptIn.currency)}
                      </span>
                      {primaryGame.slots >= 2 && (
                        <span className="font-mono text-[10.5px] text-win">
                          {formatMoneyWhole(Math.floor(primaryGame.moneyOptIn.amountMinor / primaryGame.slots), primaryGame.moneyOptIn.currency)}{" "}
                          each
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="font-mono text-[10px] text-ink-muted/75">no cost set</span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 mt-[9px]">
                  <span className="font-mono text-[10px] text-ink-muted/75">
                    booked-on games never touch the Tab. The split appears only when a cost is added
                  </span>
                  <Link
                    href={`/games/standing/${primaryGame.id}`}
                    className="font-sans font-bold text-[11px] text-action-strong flex-none transition-cu-state hover:underline"
                  >
                    edit →
                  </Link>
                </div>
              </div>
            </CardShell>
          ) : (
            <CardShell className="mt-3.5">
              <CardHeader>STANDING GAME</CardHeader>
              <div className="px-[18px] py-4 flex items-center gap-3">
                <p className="font-mono text-[10.5px] text-ink-muted flex-1">no weekly fixture yet. Set one and the RSVP runs itself</p>
                <Link
                  href={`/games/standing/new?circleId=${circleId}`}
                  className="border border-ink-hairline-4 text-ink rounded-[12px] px-4 py-2.5 font-sans font-bold text-[12px] flex-none"
                >
                  + Add a game
                </Link>
              </div>
            </CardShell>
          )}

          {restGames.map((sg) => (
            <Link
              key={sg.id}
              href={`/games/standing/${sg.id}`}
              className="mt-3 bg-surface border border-ink-hairline-1 rounded-[16px] px-[18px] py-3 flex items-center gap-[11px] transition-cu-state hover:bg-ink-hairline-1"
            >
              <div className="flex-1 min-w-0">
                <div className="font-sans font-bold text-[12.5px] text-ink truncate">
                  {WEEKDAY_PLURALS[sg.weekday]} · {formatStartTime(sg.startTime)}
                  {sg.venueName ? ` · ${sg.venueName}` : ""}
                </div>
                <div className="font-mono text-[10px] text-ink-muted mt-0.5 truncate">{standingGameFacts(sg)}</div>
              </div>
              <span className="font-sans font-bold text-[11px] text-action-strong flex-none">view →</span>
            </Link>
          ))}

          {error && (
            <Meta as="p" tone="loss" className="mt-3">
              That didn&apos;t go through. Give it another tap.
            </Meta>
          )}
        </div>
      </div>
    </div>
  );
}
