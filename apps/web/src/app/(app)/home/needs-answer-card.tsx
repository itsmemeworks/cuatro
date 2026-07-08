"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, AvatarStack } from "@/components/ui";

export type NeedsAnswerSession = {
  sessionId: string;
  circleName: string;
  venueName: string | null;
  startsAt: Date;
  confirmed: { userId: string; displayName: string; avatarUrl: string | null }[];
};

/**
 * The single surface-feature card on Home (design/HANDOFF.md screen 3):
 * "needs-your-answer card on surface-feature (single coral 'I'm in' +
 * quiet 'Can't')". Bespoke to Home rather than reusing
 * components/games/SessionCard — that component is a fuller game-detail
 * card (slot grid, countdown, reserves) meant for the games list; this is
 * the terser "answer this now" hero moment the prototype's Home screen
 * leads with. Both call the same RSVP endpoint.
 */
export function NeedsAnswerCard({ session }: { session: NeedsAnswerSession }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(action: "in" | "out") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/sessions/${session.sessionId}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  const when = session.startsAt.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const place = session.venueName ? ` · ${session.venueName}` : "";

  return (
    <Card variant="feature">
      <div className="flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-action" aria-hidden />
        <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-[#FF8A73]">NEEDS YOUR ANSWER</p>
      </div>
      <p className="text-cu-title text-[19px] leading-[1.2] mt-2.5 text-[#F5F2EC]">
        {session.circleName}
        <br />
        {when}
        {place}
      </p>
      {session.confirmed.length > 0 && (
        <div className="flex items-center gap-2.5 mt-3">
          <AvatarStack people={session.confirmed.map((p) => ({ src: p.avatarUrl, name: p.displayName }))} size="sm" ring="surface-feature" max={3} />
          <span className="text-[11.5px] font-medium" style={{ color: "rgba(250,248,244,.7)" }}>
            {session.confirmed.length} in — you make it a four
          </span>
        </div>
      )}
      {error && (
        // Fixed dark-theme loss red, not the theme-reactive `loss` token — this
        // card is dark in both themes (see the note on the buttons below).
        <p className="text-cu-meta mt-2" style={{ color: "#E56B4F" }}>
          Couldn&apos;t update your RSVP — try again.
        </p>
      )}
      {/*
        Hand-styled rather than <Button> here: surface-feature is a
        deliberately dark card in BOTH themes (see globals.css's comment on
        --color-surface-feature), so anything on it needs fixed bone/coral
        colours the same way the label/title above do. Button's "quiet"
        variant uses the theme-reactive `text-ink`/`border-ink-hairline-4`
        tokens, which would render as dark-on-dark if this card were ever
        rendered under a light OS theme — the coral "primary" variant is
        fine to keep (bg-action/text-action-contrast are theme-independent).
      */}
      <div className="flex gap-2 mt-3.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("in")}
          className="flex-[2] rounded-button min-h-12 px-5 text-[14px] font-extrabold bg-action text-action-contrast transition-cu-state active:opacity-80 disabled:opacity-40"
        >
          I&apos;m in
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => respond("out")}
          className="flex-1 rounded-button min-h-12 px-5 text-[13px] font-semibold border transition-cu-state active:opacity-80 disabled:opacity-40"
          style={{ borderColor: "rgba(245,242,236,.3)", color: "rgba(245,242,236,.85)" }}
        >
          Can&apos;t
        </button>
      </div>
    </Card>
  );
}
