"use client";

import { useState } from "react";
import { Card, Meta } from "@/components/ui";
import { RosterEntry, type RosterCandidate } from "@/components/matches/roster-entry";
import { defaultTimeFor, playedAtFromChoice, type WhenChoice } from "@/components/matches/adhoc-when";

/**
 * The phone ad-hoc record flow (issue #28): a match that never had a session,
 * anchored on one of the recorder's circles. Two small choices sit above the
 * normal roster/score flow — when it was played (default "just now") and the
 * classification (seeded with the circle's default, the recorder's call) —
 * then RosterEntry/ResultEntryForm take over unchanged, posting
 * recordAdHocMatchAction instead of the session action. The synthetic played
 * session is minted server-side inside the same transaction as the match.
 *
 * One coral action per screen: the toggles here are neutral chrome; the only
 * coral is the score form's "Send to both teams".
 */
export function AdHocEntry({
  circleId,
  circleName,
  defaultGameType,
  viewerId,
  confirmed,
  candidates,
}: {
  circleId: string;
  circleName: string;
  defaultGameType: "competitive" | "friendly";
  viewerId: string;
  confirmed: RosterCandidate[];
  candidates: RosterCandidate[];
}) {
  const [when, setWhen] = useState<WhenChoice>({ mode: "now", time: "20:00" });
  const [gameType, setGameType] = useState<"competitive" | "friendly">(defaultGameType);

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-cu-card-title text-ink">When did you play?</h2>
          <Meta className="mt-1 block">Ad-hoc results cover today and yesterday.</Meta>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(
            [
              { mode: "now", label: "Just now" },
              { mode: "today", label: "Earlier today" },
              { mode: "yesterday", label: "Yesterday" },
            ] as const
          ).map((opt) => {
            const active = when.mode === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                aria-pressed={active}
                onClick={() => setWhen({ mode: opt.mode, time: opt.mode === "now" ? "20:00" : defaultTimeFor(opt.mode) })}
                className={`border rounded-full px-3.5 py-2 font-sans font-bold text-[12px] transition-cu-state ${
                  active ? "border-ink-hairline-4 text-ink bg-ink-hairline-1" : "border-ink-hairline-2 text-ink-muted"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
          {when.mode !== "now" && (
            <input
              type="time"
              value={when.time}
              onChange={(e) => setWhen((prev) => ({ ...prev, time: e.target.value || prev.time }))}
              aria-label="What time you played"
              className="rounded-button bg-ground border border-ink-hairline-2 px-3 py-2 font-mono text-[13px] text-ink"
            />
          )}
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <div>
          <h2 className="text-cu-card-title text-ink">Rated or friendly?</h2>
          <Meta className="mt-1 block">
            {circleName} plays {defaultGameType === "friendly" ? "friendlies" : "rated"} by default, this one is your call.
          </Meta>
        </div>
        <div className="flex gap-2" role="radiogroup" aria-label="Game type">
          {(
            [
              { value: "competitive", label: "Rated", meta: "moves Glass" },
              { value: "friendly", label: "Friendly", meta: "Glass stays put" },
            ] as const
          ).map((opt) => {
            const active = gameType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setGameType(opt.value)}
                className={`flex-1 border rounded-button px-3 py-2.5 text-center transition-cu-state ${
                  active ? "border-ink-hairline-4 bg-ink-hairline-1" : "border-ink-hairline-2"
                }`}
              >
                <span className={`block font-sans font-bold text-[13px] ${active ? "text-ink" : "text-ink-muted"}`}>{opt.label}</span>
                <span className="block font-mono text-[10px] text-ink-muted mt-0.5">{opt.meta}</span>
              </button>
            );
          })}
        </div>
      </Card>

      <RosterEntry
        adhoc={{ circleId, playedAtMs: playedAtFromChoice(when), gameType }}
        viewerId={viewerId}
        confirmed={confirmed}
        candidates={candidates}
      />
    </div>
  );
}
