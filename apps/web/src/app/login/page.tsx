import { redirect } from "next/navigation";
import { isSafeRelativePath } from "@/lib/safe-redirect";

/**
 * design/DESIGN-AUDIT.md L1: the onboarding welcome (Apple/Google/magic-link)
 * now lives at / itself — see app/page.tsx. This route is kept only because
 * (app)/layout.tsx's redirect-when-signed-out and auth/callback's
 * ?error=... failure path both still point at /login; it just forwards
 * both `next` and `error` through untouched.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = isSafeRelativePath(params.next) ? params.next : null;

  const qs = new URLSearchParams();
  if (next) qs.set("next", next);
  if (params.error) qs.set("error", params.error);

  const suffix = qs.toString();
  redirect(suffix ? `/?${suffix}` : "/");
}
