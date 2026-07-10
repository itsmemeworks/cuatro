import { Fact } from "@/components/ui";

/**
 * FRIENDLIES (V1-READINESS #10): a small, quiet mono marker shown on a friendly
 * game's session and result screens. Competitive games render NOTHING — the
 * default, unmarked state is a competitive game, so this only ever adds a mark,
 * never noise. Kept as one component so the badge reads identically wherever a
 * friendly game surfaces.
 */
export function FriendlyBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-chip bg-ink-hairline-2 px-2.5 py-1 ${className}`}
    >
      <Fact size="meta" weight="semibold" tone="muted" className="uppercase tracking-[0.12em]">
        Friendly
      </Fact>
    </span>
  );
}
