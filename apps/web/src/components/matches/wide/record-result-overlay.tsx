"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, SubmitButton } from "@/components/ui";
import { UNRATED_GLASS_DISPLAY, circleColorFor, formatGlass } from "@/lib/design";
import { courtSide as courtSideVocab } from "@/lib/player-attrs";
import { recordMatchAction } from "@/server/matches-actions";
import { DEFAULT_TZ, formatDayTimeCompact, formatTime, localDateKey } from "@/lib/time";
import { seatPair, seatSide } from "@/components/matches/wide/seating";
import { previewSeal, sealPreviewLine, type PreviewViewerGlass } from "@/components/matches/wide/seal-preview";
import type { RosterCandidate } from "@/components/matches/roster-entry";

/*
 * The wide (>=900px) record-a-result experience: the design's 5-step overlay
 * (CUATRO-Web-LATEST.dc.html "record a result"), rendered by /matches/new as
 * the phone flow's `hidden min-[900px]:block` sibling. Steps 1-4 live here;
 * step 5 (pending seal + how the other side sees it) is the wide match
 * detail page recordMatchAction already redirects to — same server action,
 * same wire format as the phone ResultEntryForm, no new API.
 *
 * Design laws honoured: ONE coral action per panel (each step is one panel
 * with exactly one solid-coral CTA), dashed coral circle = an open seat
 * waiting for a person only, facts in mono, no em dashes, no exclamations.
 */

export interface RecordableGameRow {
  sessionId: string;
  startsAtMs: number;
  /** The session's effective IANA timezone (venue's, else the Circle's). Optional so the current builder keeps compiling; falls back to DEFAULT_TZ until it threads one (lib/time contract). */
  timezone?: string;
  circleId: string;
  circleName: string;
  venueName: string | null;
  gameType: string;
  match: { id: string; status: string } | null;
}

export interface WideRosterPlayer extends RosterCandidate {
  courtSide: "right" | "left" | "both" | null;
}

export interface WideRosterContext {
  sessionId: string;
  startsAtMs: number;
  gameType: string;
  circleName: string;
  venueName: string | null;
  confirmed: WideRosterPlayer[];
  candidates: WideRosterPlayer[];
  viewerGlass: PreviewViewerGlass | null;
}

type Slot = WideRosterPlayer & { pending?: boolean };
type Seats = [Slot | null, Slot | null];

/** "Tue 8pm · Court X · The Four" — timezone-explicit via lib/time (the guard's F4 delegation: bare getHours/toLocaleDateString rendered raw runtime time on Fly). */
function gameTimeLine(startsAtMs: number, timeZone: string, venueName: string | null, circleName: string): string {
  return [formatDayTimeCompact(startsAtMs, timeZone), venueName, circleName].filter(Boolean).join(" · ");
}

/** "today" / "last night" / "3 days ago" — day buckets computed in the session's timezone (localDateKey), never the runtime's midnight. */
function whenMeta(startsAtMs: number, timeZone: string): string {
  const nowMs = Date.now();
  const todayKey = localDateKey(nowMs, timeZone);
  const thenKey = localDateKey(startsAtMs, timeZone);
  if (thenKey === todayKey) return "today";
  if (thenKey === localDateKey(nowMs - 24 * 60 * 60 * 1000, timeZone)) {
    const hour = Number(formatTime(startsAtMs, timeZone).slice(0, 2));
    return hour >= 17 ? "last night" : "yesterday";
  }
  // Date keys are "YYYY-MM-DD"; parsed as UTC midnights their difference is a whole number of days.
  const days = Math.round((Date.parse(todayKey) - Date.parse(thenKey)) / (24 * 60 * 60 * 1000));
  return `${days} days ago`;
}

/** Mono seat fact per the design: "4.62 · drive". Rating always; side lingo only when stated. */
function seatFact(p: Slot): string {
  const rating = p.rating != null ? formatGlass(p.rating) : UNRATED_GLASS_DISPLAY;
  const side = courtSideVocab(p.courtSide);
  const lingo = side?.lingo;
  return lingo ? `${rating} · ${lingo}` : p.isGuest ? `${rating} · guest` : rating;
}

export function RecordResultOverlay({ games, roster, viewerId }: { games: RecordableGameRow[]; roster: WideRosterContext | null; viewerId: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(roster ? 2 : 1);

  // The four seats, teams already assigned (the wide flow pairs people in
  // step 2; the phone flow does it later via PairingSelect — same wire
  // format either way). Default: RSVP order, first two vs next two, each
  // pair then seated onto preferred sides. Every swap after that is free.
  const [seatsA, setSeatsA] = useState<Seats>(() => defaultSeats(roster, "A"));
  const [seatsB, setSeatsB] = useState<Seats>(() => defaultSeats(roster, "B"));
  const [selected, setSelected] = useState<{ team: "A" | "B"; seat: 0 | 1 } | null>(null);
  const [guestDraft, setGuestDraft] = useState<string | null>(null);
  const guestTokenSeq = useRef(0);

  // Scores are stored grid-aligned (team A = the left column in steps 2 and
  // 3), so what you see is what goes on the wire — no perspective flip.
  const [sets, setSets] = useState<{ a: string; b: string }[]>([
    { a: "", b: "" },
    { a: "", b: "" },
  ]);
  const [retired, setRetired] = useState(false);

  // Step 1's "Log this" navigates to ?session=<id>, which re-renders THIS
  // mounted component with a fresh `roster` prop — it never remounts, so the
  // lazy useState initialisers above ran before any game was picked (QA5:
  // stuck on step 1, RSVP'd four not seated). Re-derive every roster-dependent
  // piece of state when the picked session changes — React's documented
  // "adjust state during render" pattern — so ONE click lands on step 2 with
  // the confirmed pair already seated on their preferred sides.
  const [rosterKey, setRosterKey] = useState<string | null>(roster?.sessionId ?? null);
  if ((roster?.sessionId ?? null) !== rosterKey) {
    setRosterKey(roster?.sessionId ?? null);
    setStep(roster ? 2 : 1);
    setSeatsA(defaultSeats(roster, "A"));
    setSeatsB(defaultSeats(roster, "B"));
    setSelected(null);
    setGuestDraft(null);
    setSets([
      { a: "", b: "" },
      { a: "", b: "" },
    ]);
    setRetired(false);
  }

  const seated = [...seatsA, ...seatsB].filter((s): s is Slot => s != null);
  const seatedIds = new Set(seated.map((s) => s.id));
  const pool: Slot[] = useMemo(() => {
    if (!roster) return [];
    const all = [...roster.confirmed, ...roster.candidates];
    const seen = new Set<string>();
    return all.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [roster]);
  const swapIns = pool.filter((p) => !seatedIds.has(p.id));
  const guests = seated.filter((s) => s.pending);

  const full = seated.length === 4;
  const viewerSeated = seatedIds.has(viewerId);
  const filledSets = sets.filter((s) => s.a !== "" && s.b !== "").map((s) => ({ a: Number(s.a), b: Number(s.b) }));

  function close() {
    router.push(roster ? `/games/${roster.sessionId}` : "/home");
  }

  function setSeat(team: "A" | "B", seat: 0 | 1, value: Slot | null) {
    const setter = team === "A" ? setSeatsA : setSeatsB;
    setter((prev) => {
      const next: Seats = [...prev] as Seats;
      next[seat] = value;
      return next;
    });
  }

  function swapWithinTeam(team: "A" | "B") {
    const setter = team === "A" ? setSeatsA : setSeatsB;
    setter((prev) => [prev[1], prev[0]] as Seats);
    setSelected(null);
  }

  function firstEmpty(): { team: "A" | "B"; seat: 0 | 1 } | null {
    if (seatsA[0] == null) return { team: "A", seat: 0 };
    if (seatsA[1] == null) return { team: "A", seat: 1 };
    if (seatsB[0] == null) return { team: "B", seat: 0 };
    if (seatsB[1] == null) return { team: "B", seat: 1 };
    return null;
  }

  function addToCourt(p: Slot) {
    // A selected seat takes the newcomer (the old occupant returns to the
    // pool); otherwise they fill the first open seat, nudged onto their
    // preferred side if the seat next to them is also free.
    const target = selected ?? firstEmpty();
    if (!target) return;
    const seats = target.team === "A" ? seatsA : seatsB;
    const partnerSeat = target.seat === 0 ? 1 : 0;
    if (!selected && seats[partnerSeat] == null && p.courtSide && p.courtSide !== "both") {
      const preferred: 0 | 1 = seatSide(target.team, 0) === p.courtSide ? 0 : 1;
      setSeat(target.team, preferred, p);
    } else {
      setSeat(target.team, target.seat, p);
    }
    setSelected(null);
  }

  function tapSeat(team: "A" | "B", seat: 0 | 1) {
    const current = (team === "A" ? seatsA : seatsB)[seat];
    if (!selected) {
      setSelected({ team, seat });
      return;
    }
    if (selected.team === team && selected.seat === seat) {
      setSelected(null);
      return;
    }
    // Two taps = trade places (works across teams, and into an empty seat).
    const other = (selected.team === "A" ? seatsA : seatsB)[selected.seat];
    setSeat(selected.team, selected.seat, current);
    setSeat(team, seat, other);
    setSelected(null);
  }

  function removeSeat(team: "A" | "B", seat: 0 | 1) {
    setSeat(team, seat, null);
    setSelected(null);
  }

  function addGuest(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const token = `wg${guestTokenSeq.current++}`;
    addToCourt({ id: token, displayName: trimmed, rating: null, avatarUrl: null, isGuest: true, courtSide: null, pending: true });
    setGuestDraft(null);
  }

  const preview =
    roster && roster.viewerGlass && full && viewerSeated && roster.gameType !== "friendly"
      ? previewSeal({
          viewerId,
          viewerGlass: roster.viewerGlass,
          teamA: [toPreview(seatsA[0]!), toPreview(seatsA[1]!)],
          teamB: [toPreview(seatsB[0]!), toPreview(seatsB[1]!)],
          sets: filledSets,
          playedAtMs: roster.startsAtMs,
        })
      : null;

  const viewerOnA = seatsA.some((s) => s?.id === viewerId);
  const yourPair = (viewerOnA ? seatsA : seatsB).filter((s): s is Slot => s != null);
  const oppPair = (viewerOnA ? seatsB : seatsA).filter((s): s is Slot => s != null);
  const oppRatings = oppPair.map((p) => p.rating).filter((r): r is number => r != null);
  const oppAvg = oppRatings.length > 0 ? oppRatings.reduce((a, b) => a + b, 0) / oppRatings.length : null;
  const oppNeedsAccount = oppPair.length === 2 && oppPair.every((p) => p.isGuest);
  const yourScore = filledSets.map((s) => (viewerOnA ? `${s.a}–${s.b}` : `${s.b}–${s.a}`)).join(" · ");

  const rated = roster?.gameType !== "friendly";

  return (
    <div className="fixed inset-0 z-40 bg-[rgba(10,9,8,0.72)] overflow-y-auto" role="dialog" aria-modal="true" aria-label="Record a result">
      <div className="max-w-[720px] mx-auto my-14 bg-surface border border-ink-hairline-2 rounded-[22px] shadow-[0_30px_80px_rgba(0,0,0,0.6)] overflow-hidden">
        {/* header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ink-hairline-1">
          <span className="flex-1 font-sans font-extrabold text-[11px] tracking-[0.14em] text-ink-muted">RECORD A RESULT</span>
          <span className="font-mono text-[10px] text-ink-muted/70">records who played, not who answered</span>
          <button type="button" onClick={close} aria-label="Close" className="font-bold text-[13px] text-ink-muted hover:text-ink transition-cu-state px-1">
            ✕
          </button>
        </div>

        {/* step 1: which game */}
        {step === 1 && (
          <div className="px-5 pt-[18px] pb-5">
            <h2 className="font-sans font-extrabold text-[19px] text-ink">Which game was it?</h2>
            <div className="mt-3.5 bg-ground border border-ink-hairline-1 rounded-[16px] overflow-hidden">
              {games.length === 0 && (
                <p className="px-4 py-4 text-cu-body text-ink-muted">Nothing played in the last two weeks. Results start from a played game.</p>
              )}
              {games.map((g, i) => {
                const tz = g.timezone ?? DEFAULT_TZ;
                const meta = `${whenMeta(g.startsAtMs, tz)} · ${g.gameType === "friendly" ? "friendly" : "rated"}`;
                const sealed = g.match?.status === "verified";
                const pending = g.match != null && !sealed;
                const loggable = g.match == null;
                const isCurrent = roster?.sessionId === g.sessionId;
                const firstLoggable = loggable && games.findIndex((x) => x.match == null) === i;
                const inner = (
                  <>
                    <div
                      className="w-[26px] h-[26px] rounded-[9px] text-white font-sans font-extrabold text-[10px] leading-[26px] text-center flex-none"
                      style={{ background: circleColorFor(g.circleId) }}
                    >
                      {g.circleName
                        .split(/\s+/)
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="font-sans font-bold text-[13px] text-ink truncate">{gameTimeLine(g.startsAtMs, tz, g.venueName, g.circleName)}</div>
                      <div className="font-mono text-[10px] text-ink-muted mt-0.5">
                        {sealed ? "logged · sealed ✓" : pending ? "logged · waiting on the other side" : meta}
                      </div>
                    </div>
                    {loggable && firstLoggable && !isCurrent && (
                      <span className="bg-action text-action-contrast rounded-full px-3 py-1.5 font-sans font-bold text-[11px]">Log this</span>
                    )}
                    {isCurrent && <span className="font-mono text-[10px] text-ink-muted">picked</span>}
                    {((loggable && !firstLoggable && !isCurrent) || pending) && <span className="font-bold text-[14px] text-ink-muted/60">›</span>}
                  </>
                );
                const rowClass = `w-full flex items-center gap-3 px-4 py-3.5 hover:bg-ink-hairline-1 transition-cu-state ${i > 0 ? "border-t border-ink-hairline-1" : ""}`;
                return (
                  <button
                    key={g.sessionId}
                    type="button"
                    className={`${rowClass} ${sealed ? "opacity-50 hover:opacity-70" : ""}`}
                    onClick={() => {
                      // Every game row is actionable: logged ones (sealed or
                      // pending) open their match, unlogged ones start the flow.
                      if (g.match) router.push(`/matches/${g.match.id}`);
                      else if (isCurrent) setStep(2);
                      else router.push(`/matches/new?session=${g.sessionId}`);
                    }}
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* step 2: who actually played */}
        {step === 2 && roster && (
          <div className="px-5 pt-[18px] pb-5">
            <div className="flex items-baseline gap-2.5">
              <h2 className="flex-1 font-sans font-extrabold text-[19px] text-ink">Who actually played?</h2>
              <span className="font-mono text-[10px] text-ink-muted/70">seated on preferred sides · tap ⇄ to swap</span>
            </div>

            <div className="mt-3.5 bg-ground border border-ink-hairline-2 rounded-[18px] p-4 grid grid-cols-[1fr_34px_1fr] gap-3 items-center">
              <div className="flex flex-col gap-2.5">
                {[0, 1].map((i) => (
                  <SeatCard
                    key={i}
                    slot={seatsA[i as 0 | 1]}
                    viewerId={viewerId}
                    selected={selected?.team === "A" && selected.seat === i}
                    onTap={() => tapSeat("A", i as 0 | 1)}
                    onSwap={() => swapWithinTeam("A")}
                    onRemove={() => removeSeat("A", i as 0 | 1)}
                  />
                ))}
              </div>
              <div className="text-center font-mono font-extrabold text-[12px] text-ink-muted/60">vs</div>
              <div className="flex flex-col gap-2.5">
                {[0, 1].map((i) => (
                  <SeatCard
                    key={i}
                    slot={seatsB[i as 0 | 1]}
                    viewerId={viewerId}
                    selected={selected?.team === "B" && selected.seat === i}
                    onTap={() => tapSeat("B", i as 0 | 1)}
                    onSwap={() => swapWithinTeam("B")}
                    onRemove={() => removeSeat("B", i as 0 | 1)}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <span className="font-mono text-[10px] text-ink-muted/70">swap in:</span>
              {swapIns.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCourt(p)}
                  className="border border-ink-hairline-3 text-ink rounded-full px-3 py-1.5 font-sans font-semibold text-[11px] hover:bg-ink-hairline-1 hover:border-ink-hairline-4 transition-cu-state"
                >
                  {p.id === viewerId ? "You" : p.displayName} · {p.rating != null ? formatGlass(p.rating) : UNRATED_GLASS_DISPLAY}
                  {p.isGuest ? " · guest" : ""}
                </button>
              ))}
              {guestDraft === null ? (
                <button
                  type="button"
                  onClick={() => setGuestDraft("")}
                  className="border border-dashed border-action/60 text-action-strong rounded-full px-3 py-1.5 font-sans font-bold text-[11px] hover:bg-action/10 transition-cu-state"
                >
                  + Add guest
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <input
                    autoFocus
                    type="text"
                    value={guestDraft}
                    onChange={(e) => setGuestDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addGuest(guestDraft);
                      }
                      if (e.key === "Escape") setGuestDraft(null);
                    }}
                    placeholder="Their first name"
                    maxLength={40}
                    className="rounded-full bg-ground border border-ink-hairline-3 px-3 py-1.5 text-[11px] font-sans text-ink placeholder:text-ink-muted w-[150px]"
                  />
                  <button
                    type="button"
                    onClick={() => addGuest(guestDraft)}
                    disabled={guestDraft.trim() === ""}
                    className="border border-ink-hairline-3 text-ink rounded-full px-3 py-1.5 font-sans font-bold text-[11px] disabled:opacity-40 hover:bg-ink-hairline-1 transition-cu-state"
                  >
                    Add
                  </button>
                </span>
              )}
            </div>
            <p className="font-mono text-[10px] text-ink-muted/70 mt-2">guests are real rows. Name only, they can claim their history later</p>

            {full && !viewerSeated && (
              <p className="text-cu-meta text-ink-muted mt-3">
                You&apos;re logging this, so you need to be one of the four. Take someone out and add yourself.
              </p>
            )}

            <div className="flex items-center gap-2 mt-4">
              <button type="button" onClick={() => setStep(1)} className="px-4 py-3 font-sans font-semibold text-[12.5px] text-ink-muted hover:text-ink transition-cu-state">
                ‹ Back
              </button>
              <span className="flex-1" />
              <button
                type="button"
                disabled={!full || !viewerSeated}
                onClick={() => setStep(3)}
                className="bg-action text-action-contrast rounded-[13px] px-[26px] py-[13px] font-sans font-extrabold text-[13.5px] disabled:opacity-40 hover:opacity-90 transition-cu-state"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* step 3: score */}
        {step === 3 && roster && (
          <div className="px-5 pt-[18px] pb-5">
            <div className="flex items-center gap-2.5">
              <h2 className="flex-1 font-sans font-extrabold text-[19px] text-ink">How did it go?</h2>
              <span className="border border-ink-hairline-2 text-ink-muted rounded-full px-[11px] py-[5px] font-mono font-semibold text-[10px] whitespace-nowrap">
                {rated ? "🔒 RATED · moves Glass" : "FRIENDLY · Glass stays put"}
              </span>
            </div>

            <div className="mt-3.5 bg-ground border border-ink-hairline-2 rounded-[18px] p-[18px]">
              {sets.map((s, i) => (
                <div
                  key={i}
                  className={`grid grid-cols-[60px_1fr_40px_1fr] gap-3 items-center ${i > 0 ? "mt-4 pt-4 border-t border-ink-hairline-1" : ""}`}
                >
                  <span className="font-mono font-bold text-[11px] text-ink-muted/70">SET {i + 1}</span>
                  <GamesStepper value={s.a} onChange={(v) => setSets((prev) => prev.map((x, idx) => (idx === i ? { ...x, a: v } : x)))} />
                  <span className="font-sans font-extrabold text-[26px] text-ink-muted/60 text-center">–</span>
                  <GamesStepper value={s.b} onChange={(v) => setSets((prev) => prev.map((x, idx) => (idx === i ? { ...x, b: v } : x)))} />
                </div>
              ))}
              {sets.length < 3 && (
                <button
                  type="button"
                  onClick={() => setSets((prev) => [...prev, { a: "", b: "" }])}
                  className="block mx-auto mt-3.5 font-sans font-semibold text-[11px] text-ink-muted hover:text-ink transition-cu-state"
                >
                  + add set {sets.length + 1}
                </button>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 mt-2.5">
              <p className="font-mono text-[10px] text-ink-muted/70">left column is {viewerOnA ? "your" : "their"} pair, same seats as the last step</p>
              <label className="flex items-center gap-2 text-cu-meta text-ink-muted whitespace-nowrap">
                <input type="checkbox" checked={retired} onChange={(e) => setRetired(e.target.checked)} className="h-3.5 w-3.5" />
                retired early
              </label>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <button type="button" onClick={() => setStep(2)} className="px-4 py-3 font-sans font-semibold text-[12.5px] text-ink-muted hover:text-ink transition-cu-state">
                ‹ Back
              </button>
              <span className="flex-1" />
              <button
                type="button"
                disabled={filledSets.length === 0 && !retired}
                onClick={() => setStep(4)}
                className="bg-action text-action-contrast rounded-[13px] px-[26px] py-[13px] font-sans font-extrabold text-[13.5px] disabled:opacity-40 hover:opacity-90 transition-cu-state"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* step 4: send it */}
        {step === 4 && roster && (
          <form action={recordMatchAction} className="px-5 pt-[18px] pb-5">
            <input type="hidden" name="sessionId" value={roster.sessionId} />
            <input type="hidden" name="teamA1" value={seatsA[0]?.id ?? ""} />
            <input type="hidden" name="teamA2" value={seatsA[1]?.id ?? ""} />
            <input type="hidden" name="teamB1" value={seatsB[0]?.id ?? ""} />
            <input type="hidden" name="teamB2" value={seatsB[1]?.id ?? ""} />
            {retired && <input type="hidden" name="retired" value="retired" />}
            {guests.length > 0 && (
              <input type="hidden" name="guests" value={JSON.stringify(guests.map((g) => ({ token: g.id, name: g.displayName })))} />
            )}
            {sets.map((s, i) => (
              <span key={i}>
                <input type="hidden" name={`set${i + 1}_a`} value={s.a} />
                <input type="hidden" name={`set${i + 1}_b`} value={s.b} />
              </span>
            ))}

            <h2 className="font-sans font-extrabold text-[19px] text-ink">Send it to both teams</h2>
            <div className="mt-3.5 bg-ground border border-ink-hairline-2 rounded-[18px] p-[18px]">
              <div className="flex items-center gap-2.5">
                <div className="flex">
                  {yourPair.map((p, i) => (
                    <Avatar key={p.id} src={p.avatarUrl} name={p.id === viewerId ? "You" : p.displayName} size="sm" ring="surface" overlap={i > 0} />
                  ))}
                </div>
                <span className="flex-1 font-sans font-bold text-[13px] text-ink truncate">
                  {yourPair.map((p) => (p.id === viewerId ? "You" : p.displayName)).join(" & ")}
                </span>
                <span className="font-sans font-extrabold text-[24px] text-ink tabular-nums whitespace-nowrap">
                  {retired && filledSets.length === 0 ? "retired" : yourScore}
                </span>
              </div>
              <div className="flex items-center gap-2.5 mt-2.5">
                <div className="flex">
                  {oppPair.map((p, i) => (
                    <Avatar key={p.id} src={p.avatarUrl} name={p.displayName} size="sm" ring="surface" overlap={i > 0} />
                  ))}
                </div>
                <span className="flex-1 font-sans font-bold text-[13px] text-ink-muted truncate">{oppPair.map((p) => p.displayName).join(" & ")}</span>
                <span className="font-mono text-[10.5px] text-ink-muted">avg {formatGlass(oppAvg)}</span>
              </div>

              <div className="mt-3.5 border-l-2 border-action pl-3 py-0.5">
                {preview ? (
                  <>
                    <p className="font-sans text-[12px] leading-relaxed text-ink">{sealPreviewLine(preview)}</p>
                    <p className="font-mono text-[10px] text-ink-muted mt-1">nothing moves until the other side confirms</p>
                  </>
                ) : rated ? (
                  <>
                    <p className="font-sans text-[12px] leading-relaxed text-ink">
                      {roster.viewerGlass?.rating == null || seated.some((p) => p.rating == null)
                        ? "Someone on court is mid pour, so no preview. The Ledger explains every move once it seals."
                        : "Glass moves once both teams confirm. The Ledger explains every move."}
                    </p>
                    <p className="font-mono text-[10px] text-ink-muted mt-1">nothing moves until the other side confirms</p>
                  </>
                ) : (
                  <>
                    <p className="font-sans text-[12px] leading-relaxed text-ink">
                      A friendly, so Glass stays put. The score, Reliability and your played-with all still count.
                    </p>
                    <p className="font-mono text-[10px] text-ink-muted mt-1">nothing counts until the other side confirms</p>
                  </>
                )}
              </div>
            </div>

            {oppNeedsAccount && (
              <p className="text-cu-meta text-ink-muted mt-3">
                No one on the other team has a Cuatro account yet, so they can&apos;t confirm this. You can still send it, it waits until someone
                on their side joins.
              </p>
            )}

            <div className="flex items-center gap-2 mt-4">
              <button type="button" onClick={() => setStep(3)} className="px-4 py-3 font-sans font-semibold text-[12.5px] text-ink-muted hover:text-ink transition-cu-state">
                ‹ Back
              </button>
              <span className="flex-1" />
              {/* SubmitButton: pending spinner while recordMatchAction runs (mid-wave addendum, no silent clicks). */}
              <SubmitButton variant="primary" disabled={filledSets.length === 0 && !retired}>
                Send to both teams
              </SubmitButton>
            </div>
          </form>
        )}

        {/* a session-less visit that has games to pick lands on step 1; with no roster there is nothing beyond it */}
        {step !== 1 && !roster && (
          <div className="px-5 py-5">
            <p className="text-cu-body text-ink-muted">Start this from a played game, pick one from the list.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function toPreview(s: Slot) {
  return { id: s.id, rating: s.rating };
}

/** Default seating from the session's RSVP order: first two vs next two, each pair seated onto preferred sides. Exported for tests (the seat state must derive from the PICKED roster, never a pre-pick null — QA5). */
export function defaultSeats(roster: WideRosterContext | null, team: "A" | "B"): Seats {
  if (!roster) return [null, null];
  const four = roster.confirmed.slice(0, 4);
  const pair = team === "A" ? four.slice(0, 2) : four.slice(2, 4);
  if (pair.length === 2) return seatPair([pair[0]!, pair[1]!], team);
  return [pair[0] ?? null, pair[1] ?? null];
}

function SeatCard({
  slot,
  viewerId,
  selected,
  onTap,
  onSwap,
  onRemove,
}: {
  slot: Slot | null;
  viewerId: string;
  selected: boolean;
  onTap: () => void;
  onSwap: () => void;
  onRemove: () => void;
}) {
  if (!slot) {
    // An open seat: the dashed coral circle, a space waiting for a person.
    return (
      <button
        type="button"
        onClick={onTap}
        className={`bg-surface border rounded-[14px] p-3 flex items-center gap-2.5 text-left transition-cu-state hover:border-ink-hairline-4 ${
          selected ? "border-ink-hairline-4" : "border-ink-hairline-2"
        }`}
      >
        <span className="w-[34px] h-[34px] rounded-full border-[1.5px] border-dashed border-action/70 flex-none" aria-hidden />
        <span className="flex-1 font-sans font-semibold text-[12.5px] text-ink-muted">seat open</span>
      </button>
    );
  }
  const isViewer = slot.id === viewerId;
  return (
    <div
      className={`bg-surface border rounded-[14px] p-3 flex items-center gap-2.5 transition-cu-state hover:border-ink-hairline-4 ${
        selected ? "border-ink-hairline-4" : "border-ink-hairline-2"
      }`}
    >
      <button type="button" onClick={onTap} className="flex items-center gap-2.5 flex-1 min-w-0 text-left" aria-pressed={selected}>
        <Avatar src={slot.avatarUrl} name={isViewer ? "You" : slot.displayName} size="sm" ring="surface" />
        <span className="flex-1 min-w-0">
          <span className="block font-sans font-bold text-[12.5px] text-ink truncate">{isViewer ? "You" : slot.displayName}</span>
          <span className="block font-mono text-[10px] text-ink-muted">{seatFact(slot)}</span>
        </span>
      </button>
      {!isViewer && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${slot.displayName}`}
          className="text-ink-muted hover:text-ink transition-cu-state text-[15px] leading-none w-5 h-5 flex items-center justify-center rounded-full"
        >
          ×
        </button>
      )}
      <button
        type="button"
        onClick={onSwap}
        aria-label="Swap sides"
        className="border border-ink-hairline-3 text-ink-muted hover:text-ink hover:border-ink-hairline-4 transition-cu-state rounded-full w-6 h-6 font-sans font-semibold text-[11px] leading-none flex items-center justify-center flex-none"
      >
        ⇄
      </button>
    </div>
  );
}

/** The design's big-numeral stepper, kept a real input so a score can also be typed. */
function GamesStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const n = value === "" ? null : Number(value);
  function bump(dir: 1 | -1) {
    const next = Math.max(0, Math.min(99, (n ?? 0) + dir));
    onChange(String(next));
  }
  return (
    <div className="flex items-center justify-center gap-3">
      <button
        type="button"
        onClick={() => bump(-1)}
        aria-label="One game fewer"
        className="border border-ink-hairline-3 text-ink-muted hover:text-ink hover:border-ink-hairline-4 transition-cu-state rounded-full w-[26px] h-[26px] font-sans font-semibold text-[14px] leading-none flex items-center justify-center"
      >
        −
      </button>
      <input
        type="number"
        min={0}
        max={99}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="–"
        className="w-[52px] text-center bg-transparent border-none p-0 font-sans font-extrabold text-[40px] leading-none text-ink tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => bump(1)}
        aria-label="One game more"
        className="border border-ink-hairline-3 text-ink-muted hover:text-ink hover:border-ink-hairline-4 transition-cu-state rounded-full w-[26px] h-[26px] font-sans font-semibold text-[14px] leading-none flex items-center justify-center"
      >
        +
      </button>
    </div>
  );
}
