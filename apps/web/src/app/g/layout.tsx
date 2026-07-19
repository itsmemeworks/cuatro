import { GuestLandingShell } from "@/components/entry/guest-landing-shell";

/*
 * Legacy shared-game link fallback (/g/[id]) from the beta period. Never a
 * privileged lookup — see page.tsx. Outside the (app) shell, same pattern
 * as /join, /fc, /courts.
 */
export default function GLayout({ children }: { children: React.ReactNode }) {
  return <GuestLandingShell>{children}</GuestLandingShell>;
}
