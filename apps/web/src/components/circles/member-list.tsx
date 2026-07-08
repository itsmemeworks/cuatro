export interface MemberListItem {
  userId: string;
  displayName: string;
  role: "organiser" | "member";
  rating: number | null;
  confidence: number;
  reliability: number | null;
}

export function MemberList({ members }: { members: MemberListItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      {members.map((m) => (
        <div
          key={m.userId}
          className="rounded-xl p-3 flex items-center gap-3"
          style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
        >
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold uppercase shrink-0"
            style={{ background: "var(--c4-bg-elevated-2)", color: "var(--c4-text-muted)" }}
            aria-hidden
          >
            {m.displayName.slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {m.displayName}
              {m.role === "organiser" && (
                <span
                  className="ml-2 text-[10px] uppercase tracking-wide align-middle"
                  style={{ color: "var(--c4-accent)" }}
                >
                  Organiser
                </span>
              )}
            </p>
            <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
              Glass {m.rating != null ? m.rating.toFixed(2) : "Unrated"} · Confidence{" "}
              {Math.round(m.confidence * 100)}% · Reliability{" "}
              {m.reliability != null ? `${Math.round(m.reliability * 100)}%` : "no data yet"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
