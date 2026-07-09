import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { isSafeRelativePath } from "@/lib/safe-redirect";
import { OnboardingWelcome } from "@/components/entry/onboarding-welcome";

/**
 * design/DESIGN-AUDIT.md L1: / IS the onboarding welcome now — the
 * prototype's "Onboarding welcome" screen has Apple/Google/magic-link
 * directly on it, no intermediate "Get started" tap. /login (see that
 * file) now just forwards here, preserving `?next=`.
 */
export default async function LandingPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
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
