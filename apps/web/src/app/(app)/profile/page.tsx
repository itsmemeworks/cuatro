import { getSessionUser } from "@/lib/session";
import { updateDisplayNameAction } from "@/lib/actions";

export default async function ProfilePage() {
  const user = await getSessionUser();

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

      <section
        className="rounded-2xl p-5 flex flex-col gap-2"
        style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-xs font-semibold uppercase tracking-wide"
            style={{ background: "var(--c4-bg-elevated-2)", border: "1px dashed var(--c4-border)", color: "var(--c4-text-muted)" }}
          >
            —.——
          </div>
          <div>
            <p className="font-medium">Glass: Unrated</p>
            <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
              Play your Placement Trio — your first 3 verified matches — and your
              Glass rating appears.
            </p>
          </div>
        </div>
        <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
          No questionnaire. No guessing. Your number only shows once real matches
          have earned it.
        </p>
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
