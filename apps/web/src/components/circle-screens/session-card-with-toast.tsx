"use client";

import Link from "next/link";
import { useToast } from "@/components/ui";
import { SessionCard, type SessionCardData } from "@/components/games/SessionCard";

/**
 * SessionCard plus the "reserve auto-promoted" toast, for pages that already
 * wrap their tree in `<ToastBoundary>` (see that file — SessionCard itself
 * can't call `useToast()` unconditionally because it also renders on Home,
 * which has no toast provider).
 */
export function SessionCardWithToast({
  data,
  viewerUserId,
  linkToSession = false,
}: {
  data: SessionCardData;
  viewerUserId: string;
  /** Wrap the card in a Link to its session detail page (matches the old /games list behaviour). */
  linkToSession?: boolean;
}) {
  const { show } = useToast();
  const card = (
    <SessionCard
      data={data}
      viewerUserId={viewerUserId}
      onPromoted={() => show("A reserve just got promoted, the four's back to full.")}
    />
  );
  return linkToSession ? (
    <Link href={`/games/${data.sessionId}`} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}
