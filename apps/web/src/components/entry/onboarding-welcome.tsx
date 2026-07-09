"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Meta } from "@/components/ui";
import { AmbientCourtLoop } from "./ambient-court-loop";
import { Wordmark } from "./wordmark";

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

const DARK_BUTTON_CLASS =
  "rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state active:opacity-80 disabled:opacity-40 disabled:pointer-events-none min-h-12 px-5 text-[15px] font-extrabold bg-[#1E1C19] border border-[rgba(245,242,236,.18)] text-[#F5F2EC]";

/**
 * The onboarding welcome (design/DESIGN-AUDIT.md L1): / IS the auth screen
 * now — Apple/Google/magic-link sit directly on the ambient court art, no
 * intermediate "Get started" tap. Ported verbatim from the old /login page
 * (same signInWithOtp / signInWithOAuth preflight logic — see handleOAuth's
 * comment below for why the preflight fetch exists), restructured to the
 * prototype's "Onboarding welcome" screen anatomy: wordmark lockup, the
 * three auth affordances, the "got a link" card, the no-fees footer.
 *
 * One layout departure from the prototype, called out explicitly in the
 * brief: tapping "Email me a magic link" reveals the email input inline
 * (`showEmailForm`) rather than there being a permanently-visible form —
 * the prototype's static mock had no room to show both states at once.
 */
export function OnboardingWelcome({
  next,
  initialErrorMessage = null,
}: {
  next: string | null;
  /** Ported from the old /login page's `?error=` handling (auth/callback's failure redirect) — see app/page.tsx. */
  initialErrorMessage?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(initialErrorMessage);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);

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

      <div className="relative pb-10 pt-safe pb-safe">
        <div className="px-7 pt-16">
          <Wordmark />
          <p className="text-[15px] leading-snug mt-2.5 max-w-xs" style={{ color: "rgba(245,242,236,.65)" }}>
            The app your padel four runs on.
          </p>
        </div>

        <div className="px-6 pt-[38px] flex flex-col gap-[9px]">
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
          <button type="button" onClick={() => handleOAuth("google")} disabled={oauthLoading !== null} className={DARK_BUTTON_CLASS}>
            <GoogleMark />
            {oauthLoading === "google" ? "Redirecting…" : "Continue with Google"}
          </button>

          {status === "sent" ? (
            <div className="rounded-card p-4 mt-1" style={{ background: "#1E1C19", border: "1px solid rgba(245,242,236,.18)" }}>
              <p className="text-cu-card-title" style={{ color: "#F5F2EC" }}>
                Check your email
              </p>
              <p className="text-cu-body mt-1" style={{ color: "rgba(245,242,236,.65)" }}>
                We sent a sign-in link to <strong style={{ color: "#F5F2EC", fontWeight: 600 }}>{email}</strong>.
              </p>
            </div>
          ) : showEmailForm ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-[9px] mt-1">
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-button px-4 py-3 text-[15px] outline-none min-h-11"
                style={{ background: "#1E1C19", border: "1px solid rgba(245,242,236,.2)", color: "#F5F2EC" }}
              />
              <div className="flex gap-[9px]">
                <button
                  type="button"
                  onClick={() => setShowEmailForm(false)}
                  className="rounded-button min-h-12 px-5 text-[15px] font-semibold"
                  style={{ background: "transparent", color: "rgba(245,242,236,.65)" }}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={status === "sending"}
                  className="flex-1 rounded-button inline-flex items-center justify-center min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast disabled:opacity-40 disabled:pointer-events-none"
                >
                  {status === "sending" ? "Sending…" : "Send magic link"}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setShowEmailForm(true)} className={DARK_BUTTON_CLASS}>
              ✉ <span>Email me a magic link</span>
            </button>
          )}
        </div>

        <div className="px-6 mt-[26px] rounded-card border border-[rgba(255,92,61,.5)] bg-surface-feature p-4">
          <p className="text-[10px] font-extrabold tracking-[0.12em] text-[#FF8A73]">GOT A GAME LINK FROM A MATE?</p>
          <p className="text-[13px] leading-[1.45] mt-1.5" style={{ color: "#F5F2EC" }}>
            Just open it — you&apos;ll be in the game in about 10 seconds. No forms, no setup.{" "}
            <span className="text-[#FF7A5C] font-extrabold">Try it →</span>
          </p>
        </div>

        <Meta as="p" className="text-center mt-6">
          no fees · no ads · no dark patterns
        </Meta>
      </div>
    </main>
  );
}
