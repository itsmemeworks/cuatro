import { GuestLandingShell } from "@/components/entry/guest-landing-shell";

/*
 * Legacy shared-player link fallback (/p/[id]) from the beta period. Never
 * a privileged lookup — see page.tsx. Outside the (app) shell.
 */
export default function PLayout({ children }: { children: React.ReactNode }) {
  return <GuestLandingShell>{children}</GuestLandingShell>;
}
