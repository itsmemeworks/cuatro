import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { Card, Meta } from "@/components/ui";
import { circleColorFor } from "@/lib/design";
import { errorCopy } from "@/lib/error-copy";

export default async function CirclesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();
  const store = await getCirclesStore();
  const myCircles = user ? await store.listCirclesForUser(user.id) : [];
  const { error } = await searchParams;

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-cu-title text-ink">Circles</h1>
        <Link
          href="/circles/new"
          className="rounded-chip bg-action text-action-contrast font-extrabold text-[13px] px-4 py-2.5 transition-cu-state active:opacity-80"
        >
          + New
        </Link>
      </div>

      {error && (
        <Card className="bg-loss-tint">
          <p className="text-cu-body text-loss">{errorCopy(error)}</p>
        </Card>
      )}

      {myCircles.length === 0 ? (
        <Card className="flex flex-col gap-1">
          <p className="text-cu-card-title text-ink">No Circles yet</p>
          <p className="text-cu-body text-ink-muted">
            Join one with a link or QR code, or create your own — this is where your padel group&apos;s chat,
            history and Standing Games live.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {myCircles.map((c) => {
            const colour = c.colour ?? circleColorFor(c.id);
            return (
              <Link key={c.id} href={`/circles/${c.id}`} className="block">
                <Card className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-card flex items-center justify-center text-xl shrink-0"
                    style={{ background: colour }}
                    aria-hidden
                  >
                    <span className="text-white font-extrabold text-base">
                      {c.emblem ?? c.name.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-cu-card-title text-ink truncate">{c.name}</p>
                    <Meta as="p" className="mt-0.5">
                      {c.memberCount} member{c.memberCount === 1 ? "" : "s"} ·{" "}
                      {c.myRole === "organiser" ? "Organiser" : "Member"}
                    </Meta>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}
