import { GuestLandingShell } from "@/components/entry/guest-landing-shell";

/*
 * Shareable court page (/courts/[slug]) — a PUBLIC surface OUTSIDE the (app)
 * shell, exactly like /join and /fc. Below 900px GuestLandingShell reproduces
 * the centred phone column; at 900px+ the clamp lifts so the court page's own
 * two-column layout can breathe (design "Atlas · Court page"). Works logged
 * out; an authed viewer sees the identical page (no personalisation at v1).
 */
export default function CourtsLayout({ children }: { children: React.ReactNode }) {
  return <GuestLandingShell>{children}</GuestLandingShell>;
}
