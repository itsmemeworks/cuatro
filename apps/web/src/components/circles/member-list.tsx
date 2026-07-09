import { Avatar, Card, Chip, Fact, Meta } from "@/components/ui";
import { formatGlass } from "@/lib/design";
import { PLACEMENT_TRIO_SIZE } from "@cuatro/glass";

export interface MemberListItem {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role: "organiser" | "member";
  rating: number | null;
  confidence: number;
  reliability: number | null;
  joinedAt: string | Date;
  verifiedMatchCount: number;
}

const NEW_MEMBER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Prototype screen 4's 3-dot Placement Trio progress — one filled dot per verified match so far, capped at PLACEMENT_TRIO_SIZE. */
function PlacementTrioProgress({ verifiedMatchCount }: { verifiedMatchCount: number }) {
  const filled = Math.min(verifiedMatchCount, PLACEMENT_TRIO_SIZE);
  return (
    <div className="flex items-center gap-1" aria-label={`Placement Trio: ${filled} of ${PLACEMENT_TRIO_SIZE} played`}>
      {Array.from({ length: PLACEMENT_TRIO_SIZE }, (_, i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${i < filled ? "bg-action" : "bg-ink-hairline-3"}`}
          aria-hidden
        />
      ))}
    </div>
  );
}

/**
 * Members tab (prototype screen 4): Glass + confidence, a reliability line
 * ("✓ shows up 97%"), and one role chip per row — ORGANISER > YOU > NEW,
 * matching the prototype's precedence (a row never carries two badges).
 * Unrated rows (rating === null) render `?.??` plus the 3-dot Placement
 * Trio progress indicator instead of a confidence line.
 */
export function MemberList({ members, currentUserId }: { members: MemberListItem[]; currentUserId: string }) {
  return (
    <Card padded={false} className="overflow-hidden">
      {members.map((m, i) => {
        const isYou = m.userId === currentUserId;
        const isNew =
          !isYou && m.role !== "organiser" && Date.now() - new Date(m.joinedAt).getTime() < NEW_MEMBER_WINDOW_MS;
        const reliabilityLabel =
          m.rating == null
            ? `Placement Trio · ${Math.min(m.verifiedMatchCount, PLACEMENT_TRIO_SIZE)} of ${PLACEMENT_TRIO_SIZE} played`
            : m.reliability != null
              ? `✓ shows up ${Math.round(m.reliability * 100)}%`
              : "no RSVP history yet";

        return (
          <div
            key={m.userId}
            className={`flex items-center gap-3 px-4 py-3.5 ${i < members.length - 1 ? "border-b border-ink-hairline-1" : ""}`}
          >
            <Avatar src={m.avatarUrl} name={m.displayName} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-cu-body font-bold text-ink truncate">{m.displayName}</span>
                {m.role === "organiser" ? (
                  <Chip tone="neutral" className="text-[9px] tracking-[0.06em]">
                    ORGANISER
                  </Chip>
                ) : isYou ? (
                  <Chip tint={{ bg: "rgba(255,92,61,0.16)", text: "var(--color-action-strong)" }} className="text-[9px] tracking-[0.06em]">
                    YOU
                  </Chip>
                ) : isNew ? (
                  <Chip tone="positive" className="text-[9px] tracking-[0.06em]">
                    NEW
                  </Chip>
                ) : null}
              </div>
              <Meta as="p" className="mt-1">
                {reliabilityLabel}
              </Meta>
            </div>
            <div className="text-right shrink-0">
              <Fact size="lg" weight="bold" tone={m.rating == null ? "muted" : "neutral"}>
                {formatGlass(m.rating)}
              </Fact>
              {m.rating != null ? (
                <Meta as="p" className="mt-0.5">
                  conf {Math.round(m.confidence * 100)}%
                </Meta>
              ) : (
                <div className="mt-1 flex justify-end">
                  <PlacementTrioProgress verifiedMatchCount={m.verifiedMatchCount} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
