import { Chip, Meta } from "@/components/ui";
import type { ChipTone } from "@/components/ui";

/** Show-up rate + RSVP discipline badge — "social proof, not surveillance" (design/HANDOFF.md screen 8). */
export function ReliabilityBadge({ pct, lateCancelCount }: { pct: number | null; lateCancelCount: number }) {
  if (pct === null) {
    return <Meta>Reliability badge appears after your first RSVP.</Meta>;
  }

  const tone: ChipTone = pct >= 90 ? "positive" : pct >= 70 ? "streak" : "negative";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Chip tone={tone}>✓ Shows up · {pct}%</Chip>
      {lateCancelCount > 0 && (
        <Meta>
          {lateCancelCount} late cancel{lateCancelCount === 1 ? "" : "s"}
        </Meta>
      )}
    </div>
  );
}
