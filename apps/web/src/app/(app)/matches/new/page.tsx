import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore } from "@/server/matches-db";
import { recordMatchAction } from "@/server/matches-actions";

const inputStyle = {
  background: "var(--c4-bg-elevated-2)",
  border: "1px solid var(--c4-border)",
  color: "var(--c4-text)",
} as const;

export default async function NewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { session: sessionId } = await searchParams;
  if (!sessionId) {
    return (
      <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Record result</h1>
        <p style={{ color: "var(--c4-text-muted)" }}>
          Start this from a played session — open it from Home and tap &ldquo;Record result&rdquo;.
        </p>
      </main>
    );
  }

  const store = await getMatchesStore();
  const data = await store.getSessionForEntry(sessionId);

  if (!data) {
    return (
      <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Record result</h1>
        <p style={{ color: "var(--c4-text-muted)" }}>That session couldn&apos;t be found.</p>
      </main>
    );
  }

  const { players } = data;

  if (players.length !== 4) {
    return (
      <main className="px-5 pt-8 pb-6 flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Record result</h1>
        <p style={{ color: "var(--c4-text-muted)" }}>
          This session needs exactly four confirmed players before a result can be recorded (currently {players.length}).
        </p>
      </main>
    );
  }

  const [p1, p2, p3, p4] = players;

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Record result</h1>
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          Both teams confirm before this moves anyone&apos;s Glass — see the Ledger for exactly why.
        </p>
      </div>

      <form action={recordMatchAction} className="flex flex-col gap-6">
        <input type="hidden" name="sessionId" value={sessionId} />

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            Teams
          </h2>
          <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
            Pick who played on each side.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div
              className="rounded-xl p-3 flex flex-col gap-2"
              style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
            >
              <p className="text-xs font-semibold" style={{ color: "var(--c4-text-muted)" }}>
                Team A
              </p>
              <select name="teamA1" defaultValue={p1!.id} required className="rounded-lg px-2 py-2 text-sm" style={inputStyle}>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <select name="teamA2" defaultValue={p2!.id} required className="rounded-lg px-2 py-2 text-sm" style={inputStyle}>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="rounded-xl p-3 flex flex-col gap-2"
              style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
            >
              <p className="text-xs font-semibold" style={{ color: "var(--c4-text-muted)" }}>
                Team B
              </p>
              <select name="teamB1" defaultValue={p3!.id} required className="rounded-lg px-2 py-2 text-sm" style={inputStyle}>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
              <select name="teamB2" defaultValue={p4!.id} required className="rounded-lg px-2 py-2 text-sm" style={inputStyle}>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            Score
          </h2>
          <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
            Games per set, Team A – Team B. Leave a set blank if it wasn&apos;t played (e.g. the match ended early).
          </p>
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-3">
              <span className="text-sm w-12" style={{ color: "var(--c4-text-muted)" }}>
                Set {n}
              </span>
              <input
                type="number"
                min={0}
                max={99}
                name={`set${n}_a`}
                required={n === 1}
                placeholder="—"
                className="w-16 rounded-lg px-3 py-2 text-center text-base"
                style={{ ...inputStyle, minHeight: "var(--c4-touch-target)" }}
              />
              <span style={{ color: "var(--c4-text-muted)" }}>–</span>
              <input
                type="number"
                min={0}
                max={99}
                name={`set${n}_b`}
                required={n === 1}
                placeholder="—"
                className="w-16 rounded-lg px-3 py-2 text-center text-base"
                style={{ ...inputStyle, minHeight: "var(--c4-touch-target)" }}
              />
            </div>
          ))}
        </section>

        <button
          type="submit"
          className="w-full rounded-xl font-semibold py-3"
          style={{ background: "var(--c4-accent)", color: "var(--c4-accent-contrast)", minHeight: "var(--c4-touch-target)" }}
        >
          Submit result
        </button>
      </form>
    </main>
  );
}
