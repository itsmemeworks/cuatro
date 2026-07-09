import { Chip, InfoTerm, Meta } from "@/components/ui";
import type { ChipTone } from "@/components/ui";

/** Show-up rate + RSVP discipline badge — "social proof, not surveillance" (design/HANDOFF.md screen 8). */
export function ReliabilityBadge({ pct, lateCancelCount }: { pct: number | null; lateCancelCount: number }) {
  if (pct === null) {
    return (
      <Meta>
        <InfoTerm term="reliability" label="Reliability" /> appears after your first RSVP
      </Meta>
    );
  }

  const tone: ChipTone = pct >= 90 ? "positive" : pct >= 70 ? "streak" : "negative";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <Chip tone={tone}>✓ Shows up · {pct}%</Chip>
        <Meta>
          <InfoTerm term="reliability" label="Reliability" />
        </Meta>
        {lateCancelCount > 0 && (
          <Meta>
            {lateCancelCount} late cancel{lateCancelCount === 1 ? "" : "s"}
          </Meta>
        )}
      </div>
      {pct >= 90 && lateCancelCount === 0 && (
        <Meta>The four notices, even when it doesn&apos;t say so.</Meta>
      )}
    </div>
  );
}
