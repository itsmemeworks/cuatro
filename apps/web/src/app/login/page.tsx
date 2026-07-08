"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setStatus(res.ok ? "sent" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="min-h-dvh flex flex-col justify-center px-6 py-12">
      <div className="w-full max-w-sm mx-auto flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Sign in</h1>
          <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
            We&apos;ll email you a link — no password to remember.
          </p>
        </div>

        {status === "sent" ? (
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
          >
            <p className="font-medium mb-1">Check your email</p>
            <p style={{ color: "var(--c4-text-muted)" }}>
              We sent a sign-in link to <strong>{email}</strong>.{" "}
              <span>In dev, check the server console for the link instead.</span>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-xl px-4 py-3 text-base outline-none"
              style={{
                background: "var(--c4-bg-elevated)",
                border: "1px solid var(--c4-border)",
                color: "var(--c4-text)",
                minHeight: "var(--c4-touch-target)",
              }}
            />
            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full rounded-xl font-semibold py-3.5 disabled:opacity-60"
              style={{
                background: "var(--c4-accent)",
                color: "var(--c4-accent-contrast)",
                minHeight: "var(--c4-touch-target)",
              }}
            >
              {status === "sending" ? "Sending…" : "Send magic link"}
            </button>
            {status === "error" && (
              <p className="text-sm" style={{ color: "var(--c4-danger)" }}>
                Something went wrong — check the email address and try again.
              </p>
            )}
          </form>
        )}

        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: "var(--c4-border)" }} />
          <span className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
            or
          </span>
          <div className="h-px flex-1" style={{ background: "var(--c4-border)" }} />
        </div>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled
            className="w-full rounded-xl font-medium py-3.5 flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
            style={{
              background: "var(--c4-bg-elevated)",
              border: "1px solid var(--c4-border)",
              minHeight: "var(--c4-touch-target)",
            }}
          >
            Continue with Google
            <span
              className="text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5"
              style={{ background: "var(--c4-bg-elevated-2)", color: "var(--c4-text-muted)" }}
            >
              soon
            </span>
          </button>
          <button
            type="button"
            disabled
            className="w-full rounded-xl font-medium py-3.5 flex items-center justify-center gap-2 opacity-50 cursor-not-allowed"
            style={{
              background: "var(--c4-bg-elevated)",
              border: "1px solid var(--c4-border)",
              minHeight: "var(--c4-touch-target)",
            }}
          >
            Continue with Apple
            <span
              className="text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5"
              style={{ background: "var(--c4-bg-elevated-2)", color: "var(--c4-text-muted)" }}
            >
              soon
            </span>
          </button>
        </div>
      </div>
    </main>
  );
}
