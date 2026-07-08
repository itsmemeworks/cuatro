import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { updateDisplayNameAction } from "@/lib/actions";
import { getMatchesStore } from "@/server/matches-db";
import { GlassHero } from "@/components/glass/glass-hero";
import { ReliabilityBadge } from "@/components/glass/reliability-badge";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) return null;

  const store = await getMatchesStore();
  const [glass, history] = await Promise.all([
    store.getProfileGlassView(user.id),
    store.getMatchHistorySummary(user.id),
  ]);

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Profile</h1>

      <section
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
      >
        <form action={updateDisplayNameAction} className="flex flex-col gap-3">
          <label htmlFor="displayName" className="text-sm font-medium">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            defaultValue={user?.displayName ?? ""}
            placeholder="What should your Circles call you?"
            className="w-full rounded-xl px-4 py-3 text-base outline-none"
            style={{
              background: "var(--c4-bg-elevated-2)",
              border: "1px solid var(--c4-border)",
              color: "var(--c4-text)",
              minHeight: "var(--c4-touch-target)",
            }}
          />
          <button
            type="submit"
            className="w-full rounded-xl font-semibold py-3"
            style={{
              background: "var(--c4-accent)",
              color: "var(--c4-accent-contrast)",
              minHeight: "var(--c4-touch-target)",
            }}
          >
            Save
          </button>
        </form>
        <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
          {user?.email}
        </p>
      </section>

      {glass && <GlassHero glass={glass} />}

      <section
        className="rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            Reliability
          </h2>
          {glass && <ReliabilityBadge pct={glass.reliabilityPct} lateCancelCount={glass.lateCancelCount} />}
        </div>
      </section>

      <section
        className="rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
            Match history
          </h2>
          <Link href="/profile/ledger" className="text-sm font-medium" style={{ color: "var(--c4-accent)" }}>
            View Ledger →
          </Link>
        </div>
        <div className="flex gap-4 text-sm">
          <p>
            <span className="font-semibold">{history.played}</span>{" "}
            <span style={{ color: "var(--c4-text-muted)" }}>played</span>
          </p>
          <p>
            <span className="font-semibold">{history.wins}</span>{" "}
            <span style={{ color: "var(--c4-text-muted)" }}>won</span>
          </p>
          <p>
            <span className="font-semibold">{history.losses}</span>{" "}
            <span style={{ color: "var(--c4-text-muted)" }}>lost</span>
          </p>
        </div>
      </section>

      <form action="/api/auth/logout" method="POST">
        <button
          type="submit"
          className="w-full rounded-xl font-medium py-3"
          style={{
            background: "transparent",
            border: "1px solid var(--c4-border)",
            color: "var(--c4-danger)",
            minHeight: "var(--c4-touch-target)",
          }}
        >
          Log out
        </button>
      </form>
    </main>
  );
}
