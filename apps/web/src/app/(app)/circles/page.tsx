import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";

export default async function CirclesPage() {
  const user = await getSessionUser();
  const store = await getCirclesStore();
  const myCircles = user ? await store.listCirclesForUser(user.id) : [];

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Circles</h1>
        <Link
          href="/circles/new"
          className="rounded-full px-4 py-2 text-sm font-semibold"
          style={{ background: "var(--c4-accent)", color: "var(--c4-accent-contrast)" }}
        >
          + New
        </Link>
      </div>

      {myCircles.length === 0 ? (
        <div
          className="rounded-2xl p-5 flex flex-col gap-1"
          style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
        >
          <p className="font-medium">No Circles yet</p>
          <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
            Join one with a link or QR code, or create your own — this is where your
            padel group&apos;s chat, history and Standing Games live.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {myCircles.map((c) => (
            <Link
              key={c.id}
              href={`/circles/${c.id}`}
              className="rounded-2xl p-4 flex items-center gap-3"
              style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0"
                style={{ background: c.colour ?? "var(--c4-bg-elevated-2)" }}
                aria-hidden
              >
                {c.emblem ?? "⭘"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{c.name}</p>
                <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
                  {c.memberCount} member{c.memberCount === 1 ? "" : "s"} ·{" "}
                  {c.myRole === "organiser" ? "Organiser" : "Member"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
