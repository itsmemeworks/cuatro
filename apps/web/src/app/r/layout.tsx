import { GuestLandingShell } from "@/components/entry/guest-landing-shell";

/*
 * Legacy sealed-result link fallback (/r/[id]) from the beta period. Never
 * a privileged lookup — see page.tsx. Outside the (app) shell.
 */
export default function RLayout({ children }: { children: React.ReactNode }) {
  return <GuestLandingShell>{children}</GuestLandingShell>;
}
