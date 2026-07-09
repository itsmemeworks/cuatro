import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { displayNameLooksDerived } from "@/lib/entry-name";
import { isSafeRelativePath } from "@/lib/safe-redirect";
import { NameCaptureForm } from "@/components/entry/name-capture-form";

/**
 * First-run name step (F6). /auth/callback routes a fresh sign-up here when
 * their display name is still the email local-part; this page re-checks that
 * server-side and forwards straight to `next` for anyone who already has a
 * chosen name (a returning user who lands here directly), so the prompt only
 * ever shows when there's a real derived-name to fix.
 */
export default async function WelcomeNamePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next: rawNext } = await searchParams;
  const next = isSafeRelativePath(rawNext) ? rawNext : "/home";

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  if (!displayNameLooksDerived(user.displayName, user.email)) redirect(next);

  return <NameCaptureForm guess={user.displayName ?? ""} next={next} />;
}
