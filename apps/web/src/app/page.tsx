import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { Meta } from "@/components/ui";
import { AmbientCourtLoop } from "@/components/entry/ambient-court-loop";
import { Wordmark } from "@/components/entry/wordmark";

// Matches components/ui/button.tsx's `variant="primary" size="lg" fullWidth`
// class recipe exactly — reused here (rather than importing Button) because
// Button always renders a <button>, and this needs to be a real <Link> for
// a same-tap navigation with no client JS on the critical path.
const PRIMARY_LG_LINK_CLASS =
  "rounded-button inline-flex items-center justify-center gap-2 select-none transition-cu-state active:opacity-80 w-full min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast";

export default async function LandingPage() {
  const user = await getSessionUser();
  if (user) redirect("/home");

  return (
    <main className="relative min-h-dvh overflow-hidden flex flex-col">
      <AmbientCourtLoop className="absolute inset-0" />

      <div className="relative flex-1 flex flex-col justify-between px-6 pt-16 pb-10 pt-safe pb-safe">
        <div className="pl-1">
          <Wordmark />
          <p className="text-[15px] leading-snug mt-2.5 max-w-xs" style={{ color: "rgba(245,242,236,.65)" }}>
            The app your padel four runs on.
          </p>
        </div>

        <div className="flex flex-col gap-4 w-full max-w-sm mx-auto">
          <Link href="/login" className={PRIMARY_LG_LINK_CLASS}>
            Get started
          </Link>

          <div className="rounded-card border border-[rgba(255,92,61,.5)] bg-surface-feature p-4">
            <p className="text-[10px] font-extrabold tracking-[0.12em] text-[#FF8A73]">GOT A GAME LINK FROM A MATE?</p>
            <p className="text-[13px] leading-snug mt-1.5 text-[#F5F2EC]">
              Open it and you&apos;re in the game in about 10 seconds — no forms, no setup.
            </p>
          </div>

          <Meta as="p" className="text-center mt-1">
            no fees · no ads · no dark patterns
          </Meta>
        </div>
      </div>
    </main>
  );
}
