"use client";

import { Card, Fact, Meta } from "@/components/ui";
import { useRespectToggle } from "./use-respect-toggle";

export interface PlacementRevealPostData {
  ratingEventId: string;
  matchId: string;
  playedAt: string; // ISO
  displayName: string;
  rating: number;
  confidencePct: number;
  verifiedGamesRequired: number;
  respectCount: number;
  viewerRespected: boolean;
}

/**
 * "P finished their Placement Trio — Glass revealed: 4.15 / 3 verified
 * games · confidence 41%" (design/DESIGN-AUDIT.md C5/F2). Functional-minimal
 * on purpose: the pixel-perfect wave owns final layout — this establishes
 * the data-to-copy mapping and reuses ResultPost's 👏 Respect toggle exactly
 * (see PlacementRevealView's header note in server/feed.ts on why that's
 * trivial here: the reveal's matchId is the match that triggered it).
 *
 * "their" rather than a gendered pronoun — the prototype's mock copy uses
 * "her", but Cuatro doesn't collect gender, so this deliberately stays
 * neutral rather than guessing.
 */
export function PlacementRevealPost({ data }: { data: PlacementRevealPostData }) {
  const { respected, count, pending, toggle } = useRespectToggle(data.matchId, data.viewerRespected, data.respectCount);

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-cu-body text-ink">
        <span className="font-bold">{data.displayName}</span> finished their Placement Trio — Glass revealed:{" "}
        <Fact as="span" weight="bold">
          {data.rating.toFixed(2)}
        </Fact>{" "}
        / {data.verifiedGamesRequired} verified games · confidence {data.confidencePct}%
      </p>

      <div className="flex items-center gap-4 pt-1 border-t border-ink-hairline-1 -mx-4 px-4 pt-3">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={`rounded-chip px-3 py-1.5 text-[12px] font-bold flex items-center gap-1.5 transition-cu-state active:opacity-80 disabled:opacity-60 ${
            respected ? "bg-win-tint text-win" : "bg-ink-hairline-2 text-ink"
          }`}
        >
          <span aria-hidden>👏</span> {count}
        </button>
        <Meta as="p" className="ml-auto whitespace-nowrap">
          {new Date(data.playedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
        </Meta>
      </div>
    </Card>
  );
}
