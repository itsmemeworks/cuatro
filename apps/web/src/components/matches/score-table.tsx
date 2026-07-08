import type { SetScore } from "@cuatro/db";
import { Chip, Fact, Meta } from "@/components/ui";
import type { ChipTone } from "@/components/ui";

export function ScoreTable({
  sets,
  teamAName,
  teamBName,
}: {
  sets: SetScore[];
  teamAName: string;
  teamBName: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-cu-body text-ink font-bold flex-1">{teamAName}</span>
        <div className="flex gap-3">
          {sets.map((s, i) => (
            <Fact key={i} size="lg" weight="bold">{s.a}</Fact>
          ))}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-cu-body text-ink-muted font-bold flex-1">{teamBName}</span>
        <div className="flex gap-3">
          {sets.map((s, i) => (
            <Fact key={i} size="lg" weight="bold" tone="muted">{s.b}</Fact>
          ))}
        </div>
      </div>
      <Meta className="mt-0.5">
        {sets.map((_, i) => `Set ${i + 1}`).join(" · ")}
      </Meta>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "Awaiting confirmation",
  verified: "Verified",
  disputed: "Disputed",
  void: "Void",
};

const STATUS_TONE: Record<string, ChipTone> = {
  pending_confirmation: "streak",
  verified: "positive",
  disputed: "neutral",
  void: "neutral",
};

/** Dispute is a quiet fact, never an alarm — design/HANDOFF.md: "loss colour is for outcomes only." */
export function MatchStatusBadge({ status, outcome }: { status: string; outcome?: string }) {
  return (
    <Chip tone={STATUS_TONE[status] ?? "neutral"}>
      {STATUS_LABEL[status] ?? status}
      {outcome === "retired" && " (retired)"}
    </Chip>
  );
}
