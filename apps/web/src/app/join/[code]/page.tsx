import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { circles } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getCirclesStore } from "@/server/circles";
import { getGamesClient } from "@/server/games-db";
import { listUpcomingSessionsForCircle } from "@/server/games-service";
import { getGuestToken } from "@/lib/guest-session";
import { getGuestMembership, getGuestUserId } from "@/server/guest";
import { Meta } from "@/components/ui";
import { DashedSlot } from "@/components/ui";
import { circleOgImageUrl } from "@/lib/og";
import { JoinButton } from "@/components/entry/join-button";
import {
  GuestCircleJoinFlow,
  type GuestCircleJoinInitial,
  type NextGameView,
} from "@/components/entry/guest-circle-join-flow";
import { joinCircleAction } from "./actions";

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  const store = await getCirclesStore();
  const circle = await store.getCircleByInviteCode(code);

  const title = circle ? `Join ${circle.name} on CUATRO` : "CUATRO invite";
  const description = circle
    ? `You've been invited to ${circle.name}, its chat, history and Standing Games. No account needed to see what it is.`
    : "This invite link is invalid or has expired.";
  const image = circleOgImageUrl(code);

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

function formatWhen(when: Date, timeZone: string): string {
  return when.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
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

  // Logged-out invitee: the growth-loop promise — join as a guest with just a
  // name, no account, then RSVP the next game (F1 / DESIGN.md §Growth loop).
  // A device cookie that already resolves to a guest MEMBER of this circle
  // resumes straight into the done step (with the next game), mirroring how
  // /fc/[token] resumes a returning guest; anyone else starts at the name step.
  if (!user) {
    const { db } = await getGamesClient();
    const guestToken = await getGuestToken();
    const guestUserId = guestToken ? getGuestUserId(db, guestToken) : null;
    const membership = guestUserId ? getGuestMembership(db, guestUserId, circle.id) : null;

    let initial: GuestCircleJoinInitial = { step: "join" };
    if (membership && guestUserId) {
      const tz = db.select({ timezone: circles.timezone }).from(circles).where(eq(circles.id, circle.id)).get()?.timezone
        ?? "Europe/London";
      const now = new Date();
      const next = listUpcomingSessionsForCircle(db, circle.id, guestUserId, now)[0] ?? null;

      let nextGame: NextGameView | null = null;
      if (next) {
        const rsvpOpen = now >= next.rsvpWindowOpensAt && now.getTime() < next.session.startsAt.getTime();
        nextGame = {
          sessionId: next.session.id,
          whenLabel: formatWhen(next.session.startsAt, next.venue?.timezone ?? tz),
          venueName: next.venue?.name ?? null,
          confirmedPeople: next.confirmed.map((p) => ({ src: p.avatarUrl, name: p.displayName })),
          status: next.viewerStatus,
          rsvpOpen,
          opensAtLabel: rsvpOpen ? null : formatWhen(next.rsvpWindowOpensAt, next.venue?.timezone ?? tz),
        };
      }
      initial = { step: "done", displayName: membership.displayName, nextGame };
    }

    return (
      <main className="min-h-dvh flex flex-col items-center justify-center px-6 py-12 gap-8 bg-ground text-ink">
        <div className="w-full max-w-sm flex flex-col items-center">
          <GuestCircleJoinFlow
            code={code}
            circleName={circle.name}
            circleEmblem={circle.emblem}
            circleColour={circle.colour}
            initial={initial}
          />
        </div>
        <Meta>no fees · no ads · no dark patterns</Meta>
      </main>
    );
  }

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
          Its chat, history and Standing Games, join to see what your mates have been up to.
        </p>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <DashedSlot size="lg" pulse label="4" />
        <Meta>a spot&apos;s open for you</Meta>
      </div>

      <div className="w-full max-w-xs flex flex-col items-center gap-2.5">
        <form action={joinCircleAction} className="w-full">
          <input type="hidden" name="code" value={code} />
          <JoinButton label={`Join ${circle.name}`} />
        </form>
        <Meta>last step, one tap and you&apos;re in</Meta>
      </div>
    </main>
  );
}
