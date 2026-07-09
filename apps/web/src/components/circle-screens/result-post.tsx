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
}

export interface ResultPostData {
  matchId: string;
  playedAt: string; // ISO
  sets: { a: number; b: number }[];
  outcome: "completed" | "retired" | "walkover";
  winner: "A" | "B";
  teamA: { players: ResultPostPlayer[]; avgDelta: number | null };
  teamB: { players: ResultPostPlayer[]; avgDelta: number | null };
  respectCount: number;
  viewerRespected: boolean;
  commentCount: number;
  rematchHref: string;
}

/** First names, joined — "Kav & Tom" (prototype's header/delta-line convention). */
function teamNames(team: ResultPostData["teamA"]): string {
  return team.players.map((p) => p.displayName.split(" ")[0]).join(" & ");
}

function formatDelta(delta: number): string {
  const abs = Math.abs(delta).toFixed(2);
  return delta >= 0 ? `+${abs}` : `−${abs}`; // U+2212 minus, not a hyphen
}

/** "last Tuesday" for the last 2-6 days, else a plain "9 Jul" — mirrors how a person would actually say it, without inventing a real-time-relative library for one line. */
function relativeDayLabel(iso: string): string {
  const played = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(played)) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays >= 2 && diffDays <= 6) return `last ${played.toLocaleDateString("en-GB", { weekday: "long" })}`;
  return played.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * A Feed result post (prototype screen 4): a header line naming both teams,
 * a big centered score, a centered mono Glass-delta line, and a 👏/💬
 * footer with "rematch?" (server/comments.ts — tapping 💬 opens the thread
 * in a Sheet, see comment-sheet.tsx). "rematch?" links into the circle's
 * Standing Game instead of creating anything.
 *
 * The prototype's delta line names one representative player per team
 * ("Kav +0.04 → 4.91"); this circle's feed only carries each team's
 * *average* delta (server/feed.ts's ResultPostTeam — no per-player
 * post-match rating), so it labels the average with both team members'
 * names instead of guessing which one to single out, and drops the "→
 * newRating" clause that data doesn't have.
 */
export function ResultPost({ data }: { data: ResultPostData }) {
  const { respected, count, pending, toggle: toggleRespect } = useRespectToggle(data.matchId, data.viewerRespected, data.respectCount);
  const [commentCount, setCommentCount] = useState(data.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const winningTeam = data.winner === "A" ? data.teamA : data.teamB;
  const losingTeam = data.winner === "A" ? data.teamB : data.teamA;
  const heroPlayer = winningTeam.players[0];

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
            <span className="font-bold">{teamNames(winningTeam)}</span>{" "}
            <span className="text-ink-muted">beat</span>{" "}
            <span className="font-bold">{teamNames(losingTeam)}</span>
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

      {(winningTeam.avgDelta != null || losingTeam.avgDelta != null) && (
        <div className="flex items-center justify-center gap-3 -mt-1">
          {winningTeam.avgDelta != null && (
            <Fact size="sm" weight="semibold" tone={winningTeam.avgDelta >= 0 ? "win" : "loss"}>
              {teamNames(winningTeam)} {formatDelta(winningTeam.avgDelta)}
            </Fact>
          )}
          {losingTeam.avgDelta != null && (
            <Fact size="sm" weight="semibold" tone={losingTeam.avgDelta >= 0 ? "win" : "loss"}>
              {teamNames(losingTeam)} {formatDelta(losingTeam.avgDelta)}
            </Fact>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-ink-hairline-1 -mx-4 px-4 pt-3">
        <button
          type="button"
          onClick={toggleRespect}
          disabled={pending}
          className={`rounded-chip px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5 transition-cu-state active:opacity-80 disabled:opacity-60 ${
            respected ? "bg-win-tint text-win" : "bg-ink-hairline-2 text-ink"
          }`}
        >
          <span aria-hidden>👏</span> {count}
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
