"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar, Card, Chip, Fact, Meta } from "@/components/ui";
import { CommentSheet } from "./comment-sheet";
import { useRespectToggle } from "./use-respect-toggle";

export interface ResultPostPlayer {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  /** Guests have no public profile — their name renders unlinked. Optional: absent means "not a guest". */
  isGuest?: boolean;
}

export interface ResultPostTeamData {
  players: ResultPostPlayer[];
  avgDelta: number | null;
  /** One named teammate's own delta + post-match rating (server/feed.ts's ResultPostTeam.namedDelta) — null falls back to the team-average line below. */
  namedDelta: { displayName: string; delta: number; ratingAfter: number } | null;
}

export interface ResultPostData {
  matchId: string;
  playedAt: string; // ISO
  sets: { a: number; b: number }[];
  outcome: "completed" | "retired" | "walkover";
  winner: "A" | "B";
  teamA: ResultPostTeamData;
  teamB: ResultPostTeamData;
  respectCount: number;
  viewerRespected: boolean;
  commentCount: number;
  rematchHref: string;
}

/** First names, joined — "Kav & Tom" (prototype's header/delta-line convention). */
function teamNames(team: ResultPostData["teamA"]): string {
  return team.players.map((p) => p.displayName.split(" ")[0]).join(" & ");
}

/** The header's team line, each first name a tap-through to that player's profile (guests unlinked). */
function TeamNamesLinked({ team }: { team: ResultPostTeamData }) {
  return (
    <>
      {team.players.map((p, i) => (
        <span key={p.userId}>
          {i > 0 && <span className="text-ink-muted font-normal"> &amp; </span>}
          {p.isGuest ? (
            <span className="font-bold">{p.displayName.split(" ")[0]}</span>
          ) : (
            <Link href={`/players/${p.userId}`} className="font-bold active:opacity-70">
              {p.displayName.split(" ")[0]}
            </Link>
          )}
        </span>
      ))}
    </>
  );
}

function formatDelta(delta: number): string {
  const abs = Math.abs(delta).toFixed(2);
  return delta >= 0 ? `+${abs}` : `−${abs}`; // U+2212 minus, not a hyphen
}

/** "last Tuesday" for the last 2-6 days, else a plain "9 Jul" — mirrors how a person would actually say it, without inventing a real-time-relative library for one line. */
/** The UK calendar day of an instant, as "YYYY-MM-DD" — deterministic on server (UTC) and client (any TZ), so hydration can never disagree about day boundaries. */
function ukDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function ukDayStartMs(d: Date): number {
  return Date.parse(`${ukDay(d)}T00:00:00Z`);
}

function relativeDayLabel(iso: string): string {
  const played = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((ukDayStartMs(now) - ukDayStartMs(played)) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays >= 2 && diffDays <= 6) return `last ${played.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "long" })}`;
  return played.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
}

/** "Kav +0.04 → 4.91" when a team has a named representative (server/feed.ts's ResultPostTeam.namedDelta), else "Kav & Tom +0.02" using the team average — the same tone-by-sign either way. */
function teamDeltaDisplay(team: ResultPostTeamData): { text: string; delta: number } | null {
  if (team.namedDelta) {
    const firstName = team.namedDelta.displayName.split(" ")[0];
    return { text: `${firstName} ${formatDelta(team.namedDelta.delta)} → ${team.namedDelta.ratingAfter.toFixed(2)}`, delta: team.namedDelta.delta };
  }
  if (team.avgDelta != null) {
    return { text: `${teamNames(team)} ${formatDelta(team.avgDelta)}`, delta: team.avgDelta };
  }
  return null;
}

/**
 * A Feed result post (prototype screen 4): a header line naming both teams,
 * a big centered score, a centered mono Glass-delta line, and a 👏/💬
 * footer with "rematch?" (server/comments.ts — tapping 💬 opens the thread
 * in a Sheet, see comment-sheet.tsx). "rematch?" links into the circle's
 * Standing Game instead of creating anything.
 *
 * The delta line names one representative player per team ("Kav +0.04 →
 * 4.91" — server/feed.ts's ResultPostTeam.namedDelta, first-listed teammate
 * whose Glass rating isn't Placement-hidden) and falls back to the
 * team-average line ("Kav & Tom +0.02") when neither teammate's rating is
 * visible yet — see teamDeltaDisplay.
 */
export function ResultPost({ data }: { data: ResultPostData }) {
  const { respected, count, pending, toggle: toggleRespect } = useRespectToggle(data.matchId, data.viewerRespected, data.respectCount);
  const [commentCount, setCommentCount] = useState(data.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const winningTeam = data.winner === "A" ? data.teamA : data.teamB;
  const losingTeam = data.winner === "A" ? data.teamB : data.teamA;
  const heroPlayer = winningTeam.players[0];
  const winningDelta = teamDeltaDisplay(winningTeam);
  const losingDelta = teamDeltaDisplay(losingTeam);

  return (
    <Card className="flex flex-col gap-3">
      {data.outcome !== "completed" && (
        <Chip tone="neutral" className="self-start">
          {data.outcome === "retired" ? "retired" : "walkover"}
        </Chip>
      )}

      <div className="flex items-center gap-2.5">
        <Avatar src={heroPlayer.avatarUrl} name={heroPlayer.displayName} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-cu-body text-ink leading-snug">
            <TeamNamesLinked team={winningTeam} />{" "}
            <span className="text-ink-muted">beat</span>{" "}
            <TeamNamesLinked team={losingTeam} />
          </p>
          <Meta as="p" className="mt-0.5">
            {relativeDayLabel(data.playedAt)} · confirmed ✓
          </Meta>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        {data.sets.map((s, i) => (
          <Fact key={i} as="span" size="xl" weight="bold">
            {s.a}–{s.b}
          </Fact>
        ))}
      </div>

      {(winningDelta || losingDelta) && (
        <div className="flex items-center justify-center gap-3 -mt-1">
          {winningDelta && (
            <Fact size="sm" weight="semibold" tone={winningDelta.delta >= 0 ? "win" : "loss"}>
              {winningDelta.text}
            </Fact>
          )}
          {losingDelta && (
            <Fact size="sm" weight="semibold" tone={losingDelta.delta >= 0 ? "win" : "loss"}>
              {losingDelta.text}
            </Fact>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-ink-hairline-1 -mx-4 px-4 pt-3">
        <button
          type="button"
          onClick={toggleRespect}
          disabled={pending}
          aria-label="Respect"
          aria-pressed={respected}
          className={`rounded-chip px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5 transition-cu-state active:opacity-80 disabled:opacity-60 ${
            respected ? "bg-win-tint text-win" : "bg-ink-hairline-2 text-ink"
          }`}
        >
          <span aria-hidden>👏</span> Respect <span className="tabular-nums">{count}</span>
        </button>
        <button
          type="button"
          onClick={() => setCommentsOpen(true)}
          className="rounded-chip px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5 bg-ink-hairline-2 text-ink transition-cu-state active:opacity-80"
        >
          <span aria-hidden>💬</span> {commentCount}
        </button>
        <Link href={data.rematchHref} className="ml-auto text-cu-body font-bold text-action-strong">
          rematch?
        </Link>
      </div>

      <CommentSheet
        matchId={data.matchId}
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        onCountChange={setCommentCount}
      />
    </Card>
  );
}
