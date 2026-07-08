import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { joinCircleAction } from "./actions";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const store = await getCirclesStore();
  const circle = await store.getCircleByInviteCode(code);

  if (!circle) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-3">
        <h1 className="text-xl font-semibold">Link not found</h1>
        <p className="text-sm max-w-xs" style={{ color: "var(--c4-text-muted)" }}>
          This invite link is invalid or has expired. Ask your organiser for a new one.
        </p>
      </main>
    );
  }

  const user = await getSessionUser();

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-6">
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
          style={{ background: circle.colour ?? "var(--c4-bg-elevated-2)" }}
          aria-hidden
        >
          {circle.emblem ?? "⭘"}
        </div>
        <h1 className="text-xl font-semibold">{circle.name}</h1>
        <p className="text-sm max-w-xs" style={{ color: "var(--c4-text-muted)" }}>
          You&apos;ve been invited to join this Circle — its chat, history and Standing Games.
        </p>
      </div>

      {user ? (
        <form action={joinCircleAction} className="w-full max-w-xs">
          <input type="hidden" name="code" value={code} />
          <button
            type="submit"
            className="w-full rounded-xl font-semibold py-3.5"
            style={{
              background: "var(--c4-accent)",
              color: "var(--c4-accent-contrast)",
              minHeight: "var(--c4-touch-target)",
            }}
          >
            Join {circle.name}
          </button>
        </form>
      ) : (
        <Link
          href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}
          className="w-full max-w-xs rounded-xl font-semibold py-3.5 flex items-center justify-center"
          style={{
            background: "var(--c4-accent)",
            color: "var(--c4-accent-contrast)",
            minHeight: "var(--c4-touch-target)",
          }}
        >
          Sign in to join
        </Link>
      )}
    </main>
  );
}
