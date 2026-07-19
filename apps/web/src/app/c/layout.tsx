import { GuestLandingShell } from "@/components/entry/guest-landing-shell";

/*
 * Legacy shared-Circle link fallback (/c/[id]) from the beta period. Never
 * a privileged lookup — see page.tsx. Outside the (app) shell. NB: the
 * current Circle invite flow is /join/[code] (human-readable code); this
 * route only exists for old /c/:uuid links still floating around.
 */
export default function CLayout({ children }: { children: React.ReactNode }) {
  return <GuestLandingShell>{children}</GuestLandingShell>;
}
