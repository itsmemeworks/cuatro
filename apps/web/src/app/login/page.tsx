"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSafeRelativePath } from "@/lib/safe-redirect";

type Status = "idle" | "sending" | "sent" | "error";
type OAuthProvider = "google" | "apple";

const OAUTH_DISABLED_MESSAGE: Record<OAuthProvider, string> = {
  google: "Google sign-in isn't switched on yet — use email instead.",
  apple: "Apple sign-in isn't switched on yet — use email instead.",
};

export default function LoginPage() {
  // useSearchParams() requires a Suspense boundary during static
  // generation — this wrapper is the only reason LoginPage itself isn't
  // the default export.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  // Preserved end-to-end through Supabase's PKCE flow (emailRedirectTo /
  // redirectTo below both point at /auth/callback, which forwards `next`
  // on to the final redirect) so joining a Circle survives a sign-in
  // detour, e.g. /login?next=/join/ABC123.
  const rawNext = searchParams.get("next");
  const next = isSafeRelativePath(rawNext) ? rawNext : null;
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(
    urlError === "auth_failed"
      ? "That sign-in link didn't work — try again."
      : urlError === "missing_code"
        ? "That sign-in link looked broken — try again."
        : null
  );
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);

  function callbackUrl(): string {
    const url = new URL("/auth/callback", window.location.origin);
    if (next) url.searchParams.set("next", next);
    return url.toString();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("sent");
  }

  async function handleOAuth(provider: OAuthProvider) {
    setOauthLoading(provider);
    setErrorMessage(null);

    const supabase = createClient();
    // skipBrowserRedirect: true — normally signInWithOAuth does a hard
    // `window.location` navigation straight to GoTrue's /authorize, which
    // means a disabled provider surfaces as GoTrue's raw JSON 400 error
    // page (verified against the local stack), never as an `error` this
    // function could catch. So: get the URL without navigating, preflight
    // it with a manual-redirect fetch, and only navigate once we've
    // confirmed GoTrue is actually going to redirect us to the provider.
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callbackUrl(), skipBrowserRedirect: true },
    });

    if (error || !data.url) {
      setOauthLoading(null);
      setErrorMessage(OAUTH_DISABLED_MESSAGE[provider]);
      return;
    }

    try {
      const res = await fetch(data.url, { redirect: "manual" });
      // A same-origin-policy "opaqueredirect" is what a real redirect to
      // the provider looks like under redirect:"manual" — go there for
      // real. Anything else readable (GoTrue's 400 JSON body) means the
      // provider isn't enabled.
      if (res.type !== "opaqueredirect") {
        setOauthLoading(null);
        setErrorMessage(OAUTH_DISABLED_MESSAGE[provider]);
        return;
      }
    } catch {
      // Preflight itself failed (e.g. a CORS quirk in some deploy) — fail
      // open and let GoTrue's own navigation be the source of truth rather
      // than blocking a possibly-working provider on our own probe.
    }

    window.location.href = data.url;
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

        {errorMessage && (
          <div
            className="rounded-xl p-3 text-sm"
            style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-danger)", color: "var(--c4-danger)" }}
            role="alert"
          >
            {errorMessage}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => handleOAuth("google")}
            disabled={oauthLoading !== null}
            className="w-full rounded-xl font-medium py-3.5 flex items-center justify-center gap-2 disabled:opacity-60"
            style={{
              background: "var(--c4-bg-elevated)",
              border: "1px solid var(--c4-border)",
              color: "var(--c4-text)",
              minHeight: "var(--c4-touch-target)",
            }}
          >
            {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
          </button>
          <button
            type="button"
            onClick={() => handleOAuth("apple")}
            disabled={oauthLoading !== null}
            className="w-full rounded-xl font-medium py-3.5 flex items-center justify-center gap-2 disabled:opacity-60"
            style={{
              background: "var(--c4-bg-elevated)",
              border: "1px solid var(--c4-border)",
              color: "var(--c4-text)",
              minHeight: "var(--c4-touch-target)",
            }}
          >
            {oauthLoading === "apple" ? "Redirecting…" : "Continue with Apple"}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1" style={{ background: "var(--c4-border)" }} />
          <span className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
            or
          </span>
          <div className="h-px flex-1" style={{ background: "var(--c4-border)" }} />
        </div>

        {status === "sent" ? (
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
          >
            <p className="font-medium mb-1">Check your email</p>
            <p style={{ color: "var(--c4-text-muted)" }}>
              We sent a sign-in link to <strong>{email}</strong>.
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
          </form>
        )}

        <div
          className="rounded-xl p-4 text-sm flex flex-col gap-1"
          style={{ border: "1px dashed var(--c4-border)" }}
        >
          <p className="font-medium">Got a game link from a mate?</p>
          <p style={{ color: "var(--c4-text-muted)" }}>
            Open the link they sent you — you can claim your spot before you even sign in.
          </p>
        </div>

        <p className="text-xs text-center" style={{ color: "var(--c4-text-muted)" }}>
          no fees · no ads · no dark patterns
        </p>
      </div>
    </main>
  );
}
