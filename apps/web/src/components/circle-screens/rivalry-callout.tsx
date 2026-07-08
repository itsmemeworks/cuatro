import { Meta } from "@/components/ui";

/**
 * The Feed's rivalry callout (prototype screen 4): a streak-tinted strip
 * above the result posts, e.g. "K has beaten you 6 times running". Backed
 * by server/feed.ts's computeRivalryCallout — pairwise player-vs-player
 * across the circle's verified match history, viewer-relative.
 */
export function RivalryCallout({
  opponentName,
  count,
  direction,
}: {
  opponentName: string;
  count: number;
  direction: "beaten" | "lost_to";
}) {
  const text =
    direction === "lost_to"
      ? `${opponentName} has beaten you ${count} times running`
      : `You've beaten ${opponentName} ${count} times running`;

  return (
    <div className="rounded-button px-3.5 py-2.5 flex items-center gap-2.5 bg-streak-tint border border-streak/30">
      <span aria-hidden>🔥</span>
      <Meta as="p" tone="streak" className="flex-1 font-semibold">
        {text}
      </Meta>
    </div>
  );
}
