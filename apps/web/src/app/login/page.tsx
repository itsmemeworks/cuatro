"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSafeRelativePath } from "@/lib/safe-redirect";
import { Meta } from "@/components/ui";
import { AmbientCourtLoop } from "@/components/entry/ambient-court-loop";
import { Wordmark } from "@/components/entry/wordmark";

/** Apple's mark, inline (design/HANDOFF.md's asset list: "standard sign-in button assets"). */
function AppleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#17150F"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.56-1.702z"
      />
    </svg>
  );
}

/** Google's 4-colour "G", inline (design/HANDOFF.md's asset list). */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
    </svg>
  );
}

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
    <main className="relative min-h-dvh overflow-hidden flex flex-col">
      <AmbientCourtLoop className="absolute inset-0" />

      <div className="relative flex-1 flex flex-col px-6 pt-14 pb-10 pt-safe pb-safe">
        <Wordmark size="md" className="pl-1" />
        <p className="text-[15px] leading-snug mt-2.5 pl-1" style={{ color: "rgba(245,242,236,.65)" }}>
          We&apos;ll email you a link — no password to remember.
        </p>

        <div className="w-full max-w-sm mx-auto flex flex-col gap-3 mt-9">
          {errorMessage && (
            <div className="rounded-card p-3 text-[13px] bg-loss-tint text-loss border border-loss/40" role="alert">
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            onClick={() => handleOAuth("apple")}
            disabled={oauthLoading !== null}
            className="rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state active:opacity-80 disabled:opacity-40 disabled:pointer-events-none min-h-12 px-5 text-[15px] font-extrabold bg-[#F5F2EC] text-[#17150F]"
          >
            <AppleMark />
            {oauthLoading === "apple" ? "Redirecting…" : "Continue with Apple"}
          </button>
          <button
            type="button"
            onClick={() => handleOAuth("google")}
            disabled={oauthLoading !== null}
            className="rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state active:opacity-80 disabled:opacity-40 disabled:pointer-events-none min-h-12 px-5 text-[15px] font-extrabold bg-transparent text-ink border border-ink-hairline-4"
          >
            <GoogleMark />
            {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 my-1">
            <div className="h-px flex-1 bg-ink-hairline-2" />
            <Meta>or</Meta>
            <div className="h-px flex-1 bg-ink-hairline-2" />
          </div>

          {status === "sent" ? (
            <div className="rounded-card p-4 bg-surface border border-ink-hairline-1">
              <p className="text-cu-card-title mb-1">Check your email</p>
              <p className="text-cu-body text-ink-muted">
                We sent a sign-in link to <strong className="text-ink font-semibold">{email}</strong>.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <label htmlFor="email" className="text-cu-secondary text-ink font-semibold">
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
                className="w-full rounded-button px-4 py-3 text-[15px] outline-none min-h-11 bg-surface border border-ink-hairline-3 text-ink placeholder:text-ink-muted"
              />
              <button
                type="submit"
                disabled={status === "sending"}
                className="rounded-button inline-flex items-center justify-center select-none transition-cu-state active:opacity-80 disabled:opacity-40 disabled:pointer-events-none min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast"
              >
                {status === "sending" ? "Sending…" : "Send magic link"}
              </button>
            </form>
          )}

          <div className="rounded-card border border-[rgba(255,92,61,.5)] bg-surface-feature p-4 mt-2">
            <p className="text-[10px] font-extrabold tracking-[0.12em] text-[#FF8A73]">GOT A GAME LINK FROM A MATE?</p>
            <p className="text-[13px] leading-snug mt-1.5 text-[#F5F2EC]">
              Open the link they sent you — you can claim your spot before you even sign in.
            </p>
          </div>

          <Meta as="p" className="text-center mt-2">
            no fees · no ads · no dark patterns
          </Meta>
        </div>
      </div>
    </main>
  );
}
