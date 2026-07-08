import type { Metadata } from "next";
import Link from "next/link";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { Meta } from "@/components/ui";
import { DashedSlot } from "@/components/ui";
import { circleOgImageUrl } from "@/lib/og";
import { JoinButton } from "@/components/entry/join-button";
import { joinCircleAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const store = await getCirclesStore();
  const circle = await store.getCircleByInviteCode(code);

  const title = circle ? `Join ${circle.name} on CUATRO` : "CUATRO invite";
  const description = circle
    ? `You've been invited to ${circle.name} — its chat, history and Standing Games. No account needed to see what it is.`
    : "This invite link is invalid or has expired.";
  const image = circleOgImageUrl(code);

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const store = await getCirclesStore();
  const circle = await store.getCircleByInviteCode(code);

  if (!circle) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-3 bg-ground text-ink">
        <h1 className="text-cu-title">Link not found</h1>
        <p className="text-cu-body text-ink-muted max-w-xs">
          This invite link is invalid or has expired. Ask your organiser for a new one.
        </p>
      </main>
    );
  }

  const user = await getSessionUser();

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 text-center gap-8 bg-ground text-ink">
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-3xl text-white"
          style={{ background: circle.colour ?? "var(--color-ink-hairline-3)" }}
          aria-hidden
        >
          {circle.emblem ?? "⭘"}
        </div>
        <div>
          <p className="text-[10px] font-extrabold tracking-[0.14em] text-action">YOU&apos;RE INVITED</p>
          <h1 className="text-cu-title mt-1.5">{circle.name}</h1>
        </div>
        <p className="text-cu-body text-ink-muted max-w-xs">
          Its chat, history and Standing Games — join to see what your mates have been up to.
        </p>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <DashedSlot size="lg" pulse label="4" />
        <Meta>a spot&apos;s open for you</Meta>
      </div>

      <div className="w-full max-w-xs">
        {user ? (
          <form action={joinCircleAction}>
            <input type="hidden" name="code" value={code} />
            <JoinButton label={`Join ${circle.name}`} />
          </form>
        ) : (
          <Link
            href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}
            className="rounded-button inline-flex items-center justify-center w-full min-h-12 px-5 text-[15px] font-extrabold bg-action text-action-contrast transition-cu-state active:opacity-80"
          >
            Sign in to join
          </Link>
        )}
      </div>
    </main>
  );
}
