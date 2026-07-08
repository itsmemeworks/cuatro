import { Avatar, Card, Chip, Fact, Meta } from "@/components/ui";
import { formatGlass } from "@/lib/design";

export interface MemberListItem {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  role: "organiser" | "member";
  rating: number | null;
  confidence: number;
  reliability: number | null;
  joinedAt: string | Date;
}

const NEW_MEMBER_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Members tab (prototype screen 4): Glass + confidence, a reliability line
 * ("✓ shows up 97%"), and one role chip per row — ORGANISER > YOU > NEW,
 * matching the prototype's precedence (a row never carries two badges).
 *
 * Data gap: the prototype's unrated rows show a 3-dot Placement Trio
 * progress indicator (games played so far). That count isn't in
 * `CircleMemberView` (only rating/confidence/reliability are) — surfacing it
 * would need a server-side change, which is out of scope here. Unrated rows
 * render `?.??` plus a plain "Placement Trio in progress" line instead of
 * fabricating a dot count.
 */
export function MemberList({ members, currentUserId }: { members: MemberListItem[]; currentUserId: string }) {
  return (
    <Card padded={false} className="overflow-hidden">
      {members.map((m, i) => {
        const isYou = m.userId === currentUserId;
        const isNew =
          !isYou && m.role !== "organiser" && Date.now() - new Date(m.joinedAt).getTime() < NEW_MEMBER_WINDOW_MS;
        const reliabilityLabel =
          m.reliability != null ? `✓ shows up ${Math.round(m.reliability * 100)}%` : "no RSVP history yet";

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
                  <span
                    className="rounded-chip px-3 py-1.5 text-[9px] font-bold tracking-[0.06em] bg-[color:rgba(255,92,61,0.16)] text-action-strong"
                  >
                    YOU
                  </span>
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
                <Meta as="p" className="mt-0.5">
                  Placement Trio
                </Meta>
              )}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
