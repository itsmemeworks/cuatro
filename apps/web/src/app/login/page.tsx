import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { isSafeRelativePath } from "@/lib/safe-redirect";
import { OnboardingWelcome } from "@/components/entry/onboarding-welcome";

/**
 * The auth entry screen (design/DESIGN-AUDIT.md L1: the prototype's "Onboarding
 * welcome" — Apple/Google/magic-link directly on it, no intermediate "Get
 * started" tap). This lived at / until the marketing site moved to the domain
 * root (see app/route.ts); it now renders here at /login, which is where the
 * (app) layout's signed-out redirect and auth/callback's ?error= failure path
 * already point. `?next=` and `?error=` are threaded through unchanged
 * (the callback's failure redirect target is /login?error=..., handled below).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // A signed-in user has no business on the auth screen — send them home.
  const user = await getSessionUser();
  if (user) redirect("/home");

  const { next: rawNext, error: urlError } = await searchParams;
  const next = isSafeRelativePath(rawNext) ? rawNext : null;
  const initialErrorMessage =
    urlError === "auth_failed"
      ? "That sign-in link didn't work. Try again."
      : urlError === "missing_code"
        ? "That sign-in link looked broken. Try again."
        : null;

  return <OnboardingWelcome next={next} initialErrorMessage={initialErrorMessage} />;
}
