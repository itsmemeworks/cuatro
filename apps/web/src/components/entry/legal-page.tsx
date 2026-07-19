import Link from "next/link";
import { Meta } from "@/components/ui";

/*
 * Shared prose shell for /privacy, /support, /terms — public, unauthenticated
 * pages an App Store reviewer or a prospective player reads before ever
 * signing in. Plain, readable, keyboard-accessible; no claims invented here
 * beyond what the app actually does (see each page's own content).
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[620px] flex-col gap-8 px-6 py-12">
      <div className="flex items-center gap-3">
        <img src="/landing/img/app-icon.png" width={36} height={36} alt="" className="rounded-[10px] object-cover" />
        <Link href="/" className="text-[13px] font-bold text-ink-muted hover:text-ink transition-cu-state">
          ← Cuatro
        </Link>
      </div>
      <div>
        <h1 className="text-[26px] font-extrabold tracking-tight text-ink">{title}</h1>
        <Meta as="p" className="mt-1.5">
          last updated {updated}
        </Meta>
      </div>
      <div className="prose-legal flex flex-col gap-6 text-[14px] leading-[1.65] text-ink">{children}</div>
    </main>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-extrabold text-ink">{heading}</h2>
      <div className="mt-2 flex flex-col gap-2 text-ink-muted">{children}</div>
    </section>
  );
}
