import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";

/**
 * Prototype screen 4's 3-dot Placement Trio progress — one filled dot per
 * verified match so far, capped at PLACEMENT_TRIO_SIZE. Shared by the Members
 * list (compact, `sm`) and the unrated Glass hero (`lg`), so the placement
 * metaphor reads the same the two places a player meets it. This is the ONLY
 * placement-progress indicator — the dashed coral circle (`DashedSlot`) is
 * reserved for "a space waiting for a person", never progress.
 */
export function PlacementTrioProgress({
  verifiedMatchCount,
  size = "sm",
}: {
  verifiedMatchCount: number;
  size?: "sm" | "lg";
}) {
  const filled = Math.min(verifiedMatchCount, PLACEMENT_TRIO_SIZE);
  const dot = size === "lg" ? "w-3 h-3" : "w-1.5 h-1.5";
  const gap = size === "lg" ? "gap-2" : "gap-1";
  return (
    <div className={`flex items-center ${gap}`} aria-label={`Placement Trio: ${filled} of ${PLACEMENT_TRIO_SIZE} played`}>
      {Array.from({ length: PLACEMENT_TRIO_SIZE }, (_, i) => (
        <span key={i} className={`${dot} rounded-full ${i < filled ? "bg-action" : "bg-ink-hairline-3"}`} aria-hidden />
      ))}
    </div>
  );
}
