import { Meta } from "@/components/ui";
import { ResultPost, type ResultPostData, type FeedCircleTagData } from "@/components/circle-screens/result-post";
import { PlacementRevealPost, type PlacementRevealPostData } from "@/components/circle-screens/placement-reveal-post";
import { BoardCard, type BoardCardProps } from "@/components/games/board-card";
import { OpenSlotCard, type OpenSlotCardData } from "./open-slot-card";

/** Serialized mirror of server/home-feed.ts's HomeFeedItem — safe to hand to client components. */
export type HomeFeedItemData =
  | { kind: "result"; circle: FeedCircleTagData; post: ResultPostData }
  | { kind: "placement_reveal"; circle: FeedCircleTagData; reveal: PlacementRevealPostData }
  | { kind: "open_slot"; slot: OpenSlotCardData }
  | { kind: "board_game"; game: BoardCardProps };

function itemKey(item: HomeFeedItemData): string {
  switch (item.kind) {
    case "result":
      return `result-${item.post.matchId}`;
    case "placement_reveal":
      return `reveal-${item.reveal.ratingEventId}`;
    case "open_slot":
      return `slot-${item.slot.sessionId}`;
    case "board_game":
      return `board-${item.game.sessionId}`;
  }
}

function renderItem(item: HomeFeedItemData) {
  switch (item.kind) {
    case "result":
      return <ResultPost data={item.post} circle={item.circle} />;
    case "placement_reveal":
      return <PlacementRevealPost data={item.reveal} circle={item.circle} />;
    case "open_slot":
      return <OpenSlotCard slot={item.slot} />;
    case "board_game":
      return <BoardCard {...item.game} />;
  }
}

/** "2 open spots · 5 results" for the wide header's mono fact — opportunities first, matching the list order. */
function summaryLabel(items: HomeFeedItemData[]): string {
  const opportunities = items.filter((i) => i.kind === "open_slot" || i.kind === "board_game").length;
  const activity = items.length - opportunities;
  const parts: string[] = [];
  if (opportunities > 0) parts.push(`${opportunities} open ${opportunities === 1 ? "spot" : "spots"}`);
  if (activity > 0) parts.push(`${activity} ${activity === 1 ? "result" : "results"}`);
  return parts.join(" · ");
}

/**
 * The cross-circle living feed on /home (Pete, 2026-07-12: "home should be a
 * feed, not just the calendar") — opportunities to play, then recent results
 * and Glass reveals across every Circle the viewer is in, each attributed to
 * its circle. Two faces of the same list:
 *   - `phone`: a single column below the existing phone home sections, with
 *     the phone's own section-header treatment;
 *   - `wide`: the design's uppercase tracked section header ("ACROSS YOUR
 *     CIRCLES", same treatment as the week grid's NEXT 7 DAYS bar) over a
 *     two-column masonry-feel grid.
 * No coral anywhere here — home's one coral action stays with the
 * needs-answer card/panel; opportunities are quiet links (one coral action
 * per panel, design law). Callers render it only for viewers WITH circles;
 * a circle with no activity yet gets one quiet line, never a void.
 */
export function HomeFeedSection({
  items,
  variant,
  className = "",
}: {
  items: HomeFeedItemData[];
  variant: "phone" | "wide";
  className?: string;
}) {
  const emptyLine = "Quiet for now. Results, Glass reveals and open spots from your Circles land here.";

  if (variant === "phone") {
    return (
      <section className={`flex flex-col gap-3 ${className}`}>
        <h2 className="text-cu-secondary font-bold text-ink-muted">Across your Circles</h2>
        {items.length === 0 ? (
          <Meta as="p">{emptyLine}</Meta>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div key={itemKey(item)}>{renderItem(item)}</div>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className={className}>
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-muted">ACROSS YOUR CIRCLES</span>
        {items.length > 0 && <span className="text-[10px] font-mono text-ink-muted tabular-nums">{summaryLabel(items)}</span>}
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] font-mono text-ink-muted mt-3">{emptyLine}</p>
      ) : (
        <div className="grid grid-cols-2 gap-[18px] items-start mt-3">
          {items.map((item) => (
            <div key={itemKey(item)}>{renderItem(item)}</div>
          ))}
        </div>
      )}
    </section>
  );
}
