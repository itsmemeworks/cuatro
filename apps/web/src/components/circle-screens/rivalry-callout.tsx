import { Avatar, Meta } from "@/components/ui";

/**
 * The Feed's rivalry callout (prototype screen 4): opponent's avatar,
 * streak copy, and a streak-tinted "W6 🔥" chip — backed by server/feed.ts's
 * computeRivalryCallout (pairwise player-vs-player across the circle's
 * verified match history, viewer-relative).
 */
export function RivalryCallout({
  opponentName,
  opponentAvatarUrl,
  count,
  direction,
}: {
  opponentName: string;
  opponentAvatarUrl: string | null;
  count: number;
  direction: "beaten" | "lost_to";
}) {
  const text =
    direction === "lost_to"
      ? `${opponentName} has beaten you ${count} straight — the Circle's longest active streak`
      : `You've beaten ${opponentName} ${count} straight — the Circle's longest active streak`;

  return (
    <div className="rounded-button px-3.5 py-2.5 flex items-center gap-2.5 bg-streak-tint border border-streak/30">
      <Avatar src={opponentAvatarUrl} name={opponentName} size="sm" />
      <Meta as="p" tone="streak" className="flex-1 font-semibold">
        {text}
      </Meta>
      <Meta tone="streak" className="font-extrabold shrink-0">
        W{count} 🔥
      </Meta>
    </div>
  );
}
