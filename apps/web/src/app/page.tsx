import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/home");

  return (
    <main className="min-h-dvh flex flex-col items-center justify-between px-6 py-12 text-center">
      <div />

      <div className="flex flex-col items-center gap-6 max-w-sm">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold"
          style={{ background: "var(--c4-bg-elevated)", color: "var(--c4-accent)", border: "1px solid var(--c4-border)" }}
        >
          C4
        </div>
        <h1 className="text-3xl font-semibold leading-tight">
          The app your padel four runs on.
        </h1>
        <p className="text-base" style={{ color: "var(--c4-text-muted)" }}>
          Your group organises itself, everyone shows up, and every result feeds a
          rating you can actually see through.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        <Link
          href="/login"
          className="w-full rounded-xl font-semibold text-center py-3.5"
          style={{
            background: "var(--c4-accent)",
            color: "var(--c4-accent-contrast)",
            minHeight: "var(--c4-touch-target)",
          }}
        >
          Get started
        </Link>
        <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
          No password, no questionnaire — just your email.
        </p>
      </div>
    </main>
  );
}
