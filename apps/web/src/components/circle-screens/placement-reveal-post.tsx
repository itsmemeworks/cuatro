"use client";

import { Avatar, Card, Fact, Meta } from "@/components/ui";
import { useRespectToggle } from "./use-respect-toggle";

export interface PlacementRevealPostData {
  ratingEventId: string;
  matchId: string;
  playedAt: string; // ISO
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  confidencePct: number;
  verifiedGamesRequired: number;
  respectCount: number;
  viewerRespected: boolean;
}

/**
 * "P finished their Placement Trio — Glass revealed: 4.15 / 3 verified
 * games · confidence 41%" (design/DESIGN-AUDIT.md C5/F2): one row, avatar
 * left, 👏 Respect chip right — reuses ResultPost's toggle exactly (see
 * PlacementRevealView's header note in server/feed.ts on why that's
 * trivial here: the reveal's matchId is the match that triggered it).
 *
 * "their" rather than a gendered pronoun — the prototype's mock copy uses
 * "her", but Cuatro doesn't collect gender, so this deliberately stays
 * neutral rather than guessing.
 */
export function PlacementRevealPost({ data }: { data: PlacementRevealPostData }) {
  const { respected, count, pending, toggle } = useRespectToggle(data.matchId, data.viewerRespected, data.respectCount);

  return (
    <Card className="flex items-center gap-3">
      <Avatar src={data.avatarUrl} name={data.displayName} size="md" />
      <div className="flex-1 min-w-0">
        <p className="text-cu-body text-ink leading-snug">
          <span className="font-bold">{data.displayName}</span> finished their Placement Trio,{" "}
          <Fact as="span" weight="bold" tone="action">
            Glass revealed: {data.rating.toFixed(2)}
          </Fact>
        </p>
        <Meta as="p" className="mt-0.5">
          {data.verifiedGamesRequired} verified games · confidence {data.confidencePct}%
        </Meta>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`shrink-0 rounded-chip px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5 transition-cu-state active:opacity-80 disabled:opacity-60 ${
          respected ? "bg-win-tint text-win" : "bg-ink-hairline-2 text-ink"
        }`}
      >
        <span aria-hidden>👏</span> {count}
      </button>
    </Card>
  );
}
