"use client";

/*
 * DockedChat — the persistent circle-chat column at ≥1440 in circle context
 * (WEB-SHELL-SPEC.md Wave D; design/CUATRO-Web-LATEST.dc.html "docked chat
 * rail"). Renders as the last sibling in AppShell's flex row, gated
 * `hidden min-[1440px]:flex` by the caller.
 *
 * Coordination rules (the file-header contract other files rely on):
 *
 *   ONE SUBSCRIPTION PER CIRCLE — chat's realtime traffic rides the shared
 *   channel pool (lib/realtime/shared-channels.ts): however many consumers
 *   are mounted (this dock, the Chat tab, circle-tabs' badge watcher,
 *   LiveRefresh), the socket carries exactly one channel per circle topic.
 *
 *   SINGLE CHAT INSTANCE — lib/chat-dock.ts `useChatDockActive()` is the
 *   arbiter of where CircleChat (which subscribes AND marks-read on mount)
 *   lives: true → it mounts HERE and the Chat tab renders a "docked" note
 *   (circle-tabs.tsx); false → it mounts in the Chat tab and this column
 *   renders nothing. The dock therefore marks the circle read only while
 *   it is genuinely on screen: the chat mount additionally requires the
 *   live ≥1440 media gate, never just the persisted preference, so a
 *   phone/tablet viewport (where this column is display:none) can never
 *   silently swallow unread state.
 *
 *   SSR — the column chrome is server-rendered (the default preference is
 *   docked, and below 1440 the caller's CSS hides it), so a desktop load
 *   doesn't reflow when hydration lands. CircleChat itself mounts only
 *   after hydration proves the viewport (server messages are never loaded
 *   here — the thread arrives via CircleChat's existing
 *   GET /api/circles/[id]/messages backfill, no new layout queries).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleChat } from "@/components/circles/circle-chat";
import { BookingChip } from "@/components/games/booking-chip";
import { whenLabel } from "@/components/week/format";
import { Meta } from "@/components/ui";
import { setChatDockPref, useChatDockPref, useDesktopWide } from "@/lib/chat-dock";
import type { ShellCircle } from "./contract";
import { parsePinnedGameResponse, pinnedStatusLine, type DockPinnedGame } from "./docked-pinned-game";

/**
 * The dock's pinned-game card (issue #29; design "docked chat rail"): the
 * circle's pinned game — the same first-upcoming session PinnedGameBar shows
 * on the circle pages — compact under the dock header. One light fetch per
 * circle from GET /api/circles/[id]/pinned-game (which wraps the circle
 * pages' existing pinned-game read), gated on the live ≥1440 check like the
 * chat mount so phone/tablet viewports never pay for it. Best-effort: any
 * error or "nothing upcoming" renders no card, never a broken one.
 *
 * The whole card is a Link to the game (every rendered game is actionable,
 * CLAUDE.md 7b) — so the BookingChip drops its outbound URL exactly like the
 * week grid's cells (a nested <a> is invalid HTML); the game detail behind
 * the link carries the tappable "pay on X ↗" chip.
 */
function DockedPinnedGame({ circleId, colour, wide }: { circleId: string; colour: string; wide: boolean }) {
  const [game, setGame] = useState<DockPinnedGame | null>(null);

  useEffect(() => {
    if (!wide) return;
    let cancelled = false;
    setGame(null);
    (async () => {
      try {
        const res = await fetch(`/api/circles/${circleId}/pinned-game`);
        if (!res.ok) return;
        const parsed = parsePinnedGameResponse(await res.json());
        if (!cancelled) setGame(parsed);
      } catch {
        // Best-effort — the dock just shows no card until the next mount.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [circleId, wide]);

  if (!game) return null;
  return (
    <Link
      href={`/games/${game.sessionId}`}
      className="block mx-3 mt-2.5 rounded-[12px] px-3 py-2 transition-cu-state hover:opacity-85"
      style={{ background: `${colour}22`, border: `1px solid ${colour}` }}
    >
      <p className="font-sans font-bold text-[11.5px] leading-[1.3] text-ink truncate">
        📌 {whenLabel(game.startsAt, game.timezone)} · {game.venueName ?? "Venue TBC"}
      </p>
      <p className="font-mono text-[10px] text-ink-muted mt-0.5">{pinnedStatusLine(game.slots, game.confirmedCount)}</p>
      {game.booking && (
        <div className="mt-1">
          <BookingChip booking={{ platform: game.booking.platform, url: null }} size={16} />
        </div>
      )}
    </Link>
  );
}

export function DockedChat({
  circleId,
  currentUserId,
  circle = null,
}: {
  circleId: string;
  currentUserId: string;
  /** The active circle's shell row (flag + name for the header, per the design); header falls back to a neutral "Circle chat" when absent. */
  circle?: ShellCircle | null;
}) {
  const docked = useChatDockPref();
  const wide = useDesktopWide();

  // Undocked: no column at all (chat lives in the Chat tab). Server
  // snapshot is docked=true, so SSR always paints the chrome; an undocked
  // preference removes it right after hydration.
  if (!docked) return null;

  return (
    <aside aria-label="Docked circle chat" className="sticky top-0 h-dvh w-[350px] flex-none pr-[30px] pt-[26px] pb-[34px] flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col bg-surface border border-ink-hairline-1 rounded-[20px] overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-ink-hairline-1">
          {circle ? (
            <span
              aria-hidden
              className="flex flex-none items-center justify-center text-white"
              style={{
                width: 24,
                height: 24,
                borderRadius: 8,
                background: circle.color,
                font: "800 10px var(--font-archivo), sans-serif",
              }}
            >
              {circle.emblem ?? circle.initials}
            </span>
          ) : (
            <svg
              aria-hidden
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink-muted flex-none"
            >
              <path d="M20 11.5a8 8 0 1 0-3.2 6.4L20.5 19l-.9-3.4A7.96 7.96 0 0 0 20 11.5z" />
            </svg>
          )}
          <p className="flex-1 min-w-0 truncate font-sans font-extrabold text-[13px] leading-none text-ink">
            {circle ? `${circle.name} chat` : "Circle chat"}
          </p>
          <button
            type="button"
            onClick={() => setChatDockPref(false)}
            className="rounded-chip border border-ink-hairline-3 px-2.5 py-1.5 font-mono text-[10px] font-semibold text-ink-muted transition-cu-state hover:bg-ink-hairline-1 hover:text-ink"
          >
            undock
          </button>
        </div>
        {/* The circle's pinned game rides under the header (issue #29, the
            design's dock card) — fetched client-side, ≥1440-gated like the
            chat mount below. */}
        {circle && <DockedPinnedGame circleId={circleId} colour={circle.color} wide={wide} />}
        {/* Chat mounts only once the ≥1440 media gate is live-verified —
            see the file header. Until then (SSR/hydration, or a narrower
            viewport where CSS hides this column anyway) the body is an
            empty spacer so the chrome's height doesn't jump. */}
        {wide ? (
          <div className="flex-1 min-h-0 flex flex-col px-3 pt-2 pb-3">
            <CircleChat circleId={circleId} currentUserId={currentUserId} initialMessages={[]} fill />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <Meta as="p" className="text-center px-3 pb-3">
          chat docks beside everything here · undock sends it back to its tab
        </Meta>
      </div>
    </aside>
  );
}
