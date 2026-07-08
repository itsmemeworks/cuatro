import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getMatchesStore } from "@/server/matches-db";
import { LedgerEntryRow } from "@/components/glass/ledger-entry";
import { Sparkline } from "@/components/glass/sparkline";

export default async function LedgerPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const store = await getMatchesStore();
  const entries = await store.getLedger(user.id);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Link href="/profile" className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          ← Profile
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">The Ledger</h1>
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          Every verified match, and exactly why your Glass moved.
        </p>
      </div>

      {entries.length === 0 ? (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
        >
          <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
            No verified matches yet — the Ledger fills in the moment your first result is confirmed by both teams.
          </p>
        </div>
      ) : (
        <>
          <section
            className="rounded-2xl p-4"
            style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
          >
            <Sparkline values={[...entries].reverse().map((e) => e.ratingAfter)} />
          </section>

          <section className="flex flex-col gap-2">
            {entries.map((entry) => (
              <LedgerEntryRow key={entry.id} entry={entry} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}
