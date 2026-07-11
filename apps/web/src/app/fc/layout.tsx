import { GuestLandingShell } from "@/components/entry/guest-landing-shell";

/*
 * Fourth Call guest landing (/fc/[token]). Below 900px this is the centred
 * 448 phone column exactly as before (GuestLandingShell reproduces
 * PhoneFrame there); at 900px+ the clamp lifts into the design's desktop
 * guest-link landing (CUATRO-Web-LATEST.dc.html "Guest link landing") — the
 * page's own content columns carry the per-step widths. This route stays
 * OUTSIDE the (app) shell: no rail, no topbar, works logged out.
 */
export default function FourthCallLayout({ children }: { children: React.ReactNode }) {
  return <GuestLandingShell>{children}</GuestLandingShell>;
}
