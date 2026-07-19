import Link from "next/link";
import { Meta } from "@/components/ui";

/*
 * Shared body for every browser-fallback landing that isn't the auth
 * callback: legacy /g,/p,/c,/r links and the opaque /s/:token expired/
 * invalid state. These never do a privileged lookup or a mutation — they
 * exist purely to give someone who followed a link somewhere the app
 * would otherwise handle a reasonable, on-brand landing, plus the way in.
 */

const PRIMARY_LG_LINK_CLASS =
  "rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state hover:opacity-90 active:opacity-80 w-full min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast border border-transparent";

const QUIET_LG_LINK_CLASS =
  "rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state hover:bg-ink-hairline-1 w-full min-h-12 px-5 text-[15px] font-bold text-ink border border-ink-hairline-4";

export function TestflightCta() {
  const testflightUrl = process.env.CUATRO_TESTFLIGHT_URL;
  if (testflightUrl) {
    return (
      <a href={testflightUrl} className={PRIMARY_LG_LINK_CLASS}>
        Get the TestFlight beta
      </a>
    );
  }
  return <Meta as="p">private beta opening soon</Meta>;
}

export function LinkFallbackShell({
  heading,
  body,
  children,
}: {
  heading: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <img src="/landing/img/app-icon.png" width={52} height={52} alt="" aria-hidden className="rounded-[16px] object-cover" />
      <h1 className="text-[22px] font-extrabold tracking-tight text-ink">{heading}</h1>
      <p className="max-w-[320px] text-[14px] leading-[1.5] text-ink-muted">{body}</p>
      {children}
      <TestflightCta />
      <Link href="/" className={QUIET_LG_LINK_CLASS}>
        Back to Cuatro
      </Link>
    </main>
  );
}

/** The designed dead end for an expired/invalid/unknown token or id. */
export function LinkMovedOn() {
  return (
    <LinkFallbackShell
      heading="This Cuatro link has moved on"
      body="Whoever sent it can make a fresh one from inside the app."
    />
  );
}
