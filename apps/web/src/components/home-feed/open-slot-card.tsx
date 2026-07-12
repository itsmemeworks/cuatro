import Link from "next/link";
import { Card, DashedSlot, Fact } from "@/components/ui";
import { CircleEmblem, circleColour } from "@/components/games/roster";

/** Serialized server/home-feed.ts OpenSlotView, time pre-formatted in the session's timezone. */
export interface OpenSlotCardData {
  sessionId: string;
  circleId: string;
  circleName: string;
  circleColour: string | null;
  circleEmblem: string | null;
  venueName: string | null;
  /** "Thu 20:00" in the session's own timezone. */
  whenLabel: string;
  slotsOpen: number;
}

/**
 * An opportunity card in the /home feed: one of the viewer's OWN circles'
 * games is short and they haven't answered ("Sunday Lot is one short, Thu
 * 8pm"). Deliberately QUIET — no coral, no button: the whole card links to
 * the game detail where the RSVP lives, with the standard row hover
 * affordance (7b). The dashed coral circles are the canonical "a space
 * waiting for a person" mark, one per open spot.
 */
export function OpenSlotCard({ slot }: { slot: OpenSlotCardData }) {
  const title =
    slot.slotsOpen === 1 ? `${slot.circleName} is one short` : `${slot.circleName} needs ${slot.slotsOpen} more`;
  return (
    <Link href={`/games/${slot.sessionId}`} className="block">
      <Card padded={false} className="overflow-hidden flex items-stretch transition-cu-state hover:bg-ink-hairline-1">
        <span aria-hidden className="w-1.5 shrink-0" style={{ background: circleColour(slot.circleId, slot.circleColour) }} />
        <div className="flex items-center gap-3 flex-1 min-w-0 px-3.5 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <CircleEmblem seed={slot.circleId} name={slot.circleName} emblem={slot.circleEmblem} colour={slot.circleColour} px={20} />
              <p className="text-cu-card-title text-[14px] truncate">{title}</p>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="flex items-center gap-1.5" aria-hidden>
                {Array.from({ length: Math.min(slot.slotsOpen, 4) }, (_, i) => (
                  <DashedSlot key={i} size="xs" label="" />
                ))}
              </span>
              <Fact size="meta" tone="muted" className="truncate">
                {slot.whenLabel}
                {slot.venueName ? ` · ${slot.venueName}` : ""}
              </Fact>
            </div>
          </div>
          <span className="text-cu-secondary font-bold text-ink-muted whitespace-nowrap shrink-0">Have a look ›</span>
        </div>
      </Card>
    </Link>
  );
}
