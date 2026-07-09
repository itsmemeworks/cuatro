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

function formatDelta(delta: number | null): string | null {
  if (delta == null) return null;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`;
}

function TeamColumn({ team, won }: { team: ResultPostData["teamA"]; won: boolean }) {
  const deltaLabel = formatDelta(team.avgDelta);
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5 text-center">
      <div className="flex items-center -space-x-2.5">
        {team.players.map((p) => (
          <Avatar key={p.userId} src={p.avatarUrl} name={p.displayName} size="sm" ring="surface" />
        ))}
      </div>
      <p className={`text-cu-meta font-semibold truncate max-w-full ${won ? "text-ink" : "text-ink-muted"}`}>
        {team.players.map((p) => p.displayName.split(" ")[0]).join(" & ")}
      </p>
      {deltaLabel && (
        <Fact size="sm" weight="bold" tone={team.avgDelta! >= 0 ? "win" : "loss"}>
          {deltaLabel}
        </Fact>
      )}
    </div>
  );
}

/**
 * A Feed result post (prototype screen 4): big score, both teams' Glass
 * deltas, 👏 Respect, 💬 comment count (server/comments.ts — tapping it
 * opens the thread in a Sheet, see comment-sheet.tsx). "rematch?" links
 * into the circle's Standing Game instead and creates nothing.
 */
export function ResultPost({ data }: { data: ResultPostData }) {
  const { respected, count, pending, toggle: toggleRespect } = useRespectToggle(data.matchId, data.viewerRespected, data.respectCount);
  const [commentCount, setCommentCount] = useState(data.commentCount);
  const [commentsOpen, setCommentsOpen] = useState(false);

  const scoreLabel = data.sets.map((s) => `${s.a}-${s.b}`).join(", ");

  return (
    <Card className="flex flex-col gap-3">
      {data.outcome !== "completed" && (
        <Chip tone="neutral" className="self-start">
          {data.outcome === "retired" ? "retired" : "walkover"}
        </Chip>
      )}

      <div className="flex items-center gap-3">
        <TeamColumn team={data.teamA} won={data.winner === "A"} />
        <Fact as="p" size="lg" weight="bold" tone="neutral" className="shrink-0">
          {scoreLabel}
        </Fact>
        <TeamColumn team={data.teamB} won={data.winner === "B"} />
      </div>

      <div className="flex items-center gap-4 pt-1 border-t border-ink-hairline-1 -mx-4 px-4 pt-3">
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
        <Link href={data.rematchHref} className="text-cu-body font-bold text-action-strong">
          rematch?
        </Link>
        <Meta as="p" className="ml-auto whitespace-nowrap">
          {new Date(data.playedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </Meta>
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
