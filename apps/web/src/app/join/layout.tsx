import { GuestLandingShell } from "@/components/entry/guest-landing-shell";

/*
 * Circle invite landing (/join/[code]). Below 900px this is the centred 448
 * phone column exactly as before (GuestLandingShell reproduces PhoneFrame
 * there); at 900px+ the clamp lifts into the desktop guest-landing
 * treatment shared with /fc (same shell, same glow — the design's guest
 * link landing generalised to the circle invite). Stays OUTSIDE the (app)
 * shell: no rail, no topbar, works logged out.
 */
export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return <GuestLandingShell>{children}</GuestLandingShell>;
}
