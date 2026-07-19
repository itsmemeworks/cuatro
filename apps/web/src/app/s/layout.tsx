import { GuestLandingShell } from "@/components/entry/guest-landing-shell";

/*
 * Opaque share-link fallback (/s/[token]) — public, outside the (app) shell,
 * same pattern as /join, /fc, /courts. Works without an account; the app
 * intercepts the universal link directly when installed, so this route is
 * the browser fallback (no app, or a share preview crawler).
 */
export default function ShareLinkLayout({ children }: { children: React.ReactNode }) {
  return <GuestLandingShell>{children}</GuestLandingShell>;
}
