import { getSessionUser } from "@/lib/session";

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-1"
      style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
    >
      <p className="font-medium">{title}</p>
      <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
        {body}
      </p>
    </div>
  );
}

export default async function HomePage() {
  const user = await getSessionUser();
  const name = user?.displayName || user?.email.split("@")[0] || "there";

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div>
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          Welcome back
        </p>
        <h1 className="text-2xl font-semibold">{name}</h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
          Your games this week
        </h2>
        <EmptyCard
          title="No games yet"
          body="Once you're in a Circle with a Standing Game, it'll show up here — RSVP without leaving the app."
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--c4-text-muted)" }}>
          Your Circles
        </h2>
        <EmptyCard
          title="You're not in a Circle yet"
          body="Join one with a link or QR code from a friend, or create your own to bring your padel group over from WhatsApp."
        />
      </section>
    </main>
  );
}
