import type { SetScore } from "@cuatro/db";

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
    <table className="w-full text-sm">
      <thead>
        <tr style={{ color: "var(--c4-text-muted)" }}>
          <th className="text-left font-medium py-1">Team</th>
          {sets.map((_, i) => (
            <th key={i} className="text-center font-medium py-1">
              Set {i + 1}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="py-1">{teamAName}</td>
          {sets.map((s, i) => (
            <td key={i} className="text-center tabular-nums py-1 font-semibold">
              {s.a}
            </td>
          ))}
        </tr>
        <tr>
          <td className="py-1">{teamBName}</td>
          {sets.map((s, i) => (
            <td key={i} className="text-center tabular-nums py-1 font-semibold">
              {s.b}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending_confirmation: "Awaiting confirmation",
  verified: "Verified",
  disputed: "Disputed",
  void: "Void",
};

const STATUS_COLOR: Record<string, string> = {
  pending_confirmation: "var(--c4-warning)",
  verified: "var(--c4-accent)",
  disputed: "var(--c4-danger)",
  void: "var(--c4-text-muted)",
};

export function MatchStatusBadge({ status }: { status: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
      style={{
        background: "var(--c4-bg-elevated-2)",
        color: STATUS_COLOR[status] ?? "var(--c4-text-muted)",
        border: "1px solid var(--c4-border)",
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
