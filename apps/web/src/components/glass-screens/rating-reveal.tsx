"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Meta, useToast } from "@/components/ui";
import { formatGlass } from "@/lib/design";

/**
 * The signature "Glass pour" (design/HANDOFF.md's Interactions section +
 * Directions turn 8c): fires once, the moment a player's Placement Trio
 * verifies. Digits scramble through the 1.0–7.0 scale then settle on the
 * real number over 1.5s ease-out; a blur lifts in parallel over 900ms; the
 * confidence bar draws last, +250ms after the number lands; the "Glass
 * poured" line fades in; a share offer follows.
 *
 * Gated by localStorage per user so it plays exactly once — see
 * design/HANDOFF.md's "Persist that the reveal has been SEEN" instruction.
 * Renders nothing once already seen; the caller falls through to the
 * normal GlassHero in that case.
 */
const SCALE_MIN = 1.0;
const SCALE_MAX = 7.0;

function randomGlassText(): string {
  return (SCALE_MIN + Math.random() * (SCALE_MAX - SCALE_MIN)).toFixed(2);
}

function seenKey(userId: string): string {
  return `cuatro:glass-reveal-seen:${userId}`;
}

export function hasSeenRatingReveal(userId: string): boolean {
  if (typeof window === "undefined") return true; // server render: never show, effect below decides on the client
  return window.localStorage.getItem(seenKey(userId)) != null;
}

export function RatingReveal({
  userId,
  displayName,
  rating,
  confidencePct,
  onDone,
}: {
  userId: string;
  displayName: string;
  rating: number;
  confidencePct: number;
  /** Called once the player is ready to move on (e.g. after sharing, or dismissing) — the caller falls through to its normal hero. */
  onDone?: () => void;
}) {
  const { show } = useToast();
  const [visible, setVisible] = useState(false);
  const [armed, setArmed] = useState(false);
  const [text, setText] = useState(() => randomGlassText());
  const [settled, setSettled] = useState(false);
  const [confDrawn, setConfDrawn] = useState(false);
  const [poured, setPoured] = useState(false);
  const hapticFired = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (hasSeenRatingReveal(userId)) return;
    setVisible(true);
    // Deliberately runs once on mount — re-checking on every prop change
    // would replay the pour for a rating that hasn't actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ARM only on genuine visibility (WEB-SHELL-SPEC Wave C punch item: at wide
  // widths the phone tree that hosts this component is display:none, and the
  // old mount-time timer quietly spent the once-ever pour — and its "seen"
  // flag — on a screen nobody was looking at). An element inside display:none
  // never intersects, so the IntersectionObserver simply waits: resize below
  // 900px (or a phone visit) and the pour starts fresh from the top.
  useEffect(() => {
    if (!visible) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // No way to observe (ancient browser/jsdom): behave exactly as before.
      setArmed(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setArmed(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!armed) return;

    // Marked "seen" only once the sequence actually finishes — an
    // interruption (navigating away, a remount) leaves the flag unset so
    // the player gets the real pour next time, rather than a half-blurred
    // glimpse being their one and only reveal forever.
    const markSeen = () => window.localStorage.setItem(seenKey(userId), "1");

    // The reduced-motion path lives INSIDE the armed gate on purpose: it
    // marks seen instantly, so running it while display:none would burn the
    // reveal invisibly for exactly the users the punch item protects.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setText(formatGlass(rating));
      setSettled(true);
      setConfDrawn(true);
      setPoured(true);
      markSeen();
      return;
    }

    const scrambleInterval = setInterval(() => setText(randomGlassText()), 70);
    const tSettle = setTimeout(() => {
      clearInterval(scrambleInterval);
      setText(formatGlass(rating));
      setSettled(true);
      if (!hapticFired.current && typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([20, 40, 60]); // one deep haptic, the moment the number lands
        hapticFired.current = true;
      }
    }, 1500);
    const tConf = setTimeout(() => setConfDrawn(true), 1500 + 250);
    const tPoured = setTimeout(() => {
      setPoured(true);
      markSeen();
    }, 1500 + 600);

    return () => {
      clearInterval(scrambleInterval);
      clearTimeout(tSettle);
      clearTimeout(tConf);
      clearTimeout(tPoured);
    };
    // Runs once, the moment the component becomes genuinely visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  if (!visible) return null;

  async function share() {
    const shareText = `My Glass just poured: ${formatGlass(rating)}. No rounding up, no "I'm basically a 4". Join me on CUATRO.`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ text: shareText });
        return;
      } catch {
        // user cancelled the share sheet — fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      show("Copied, paste it anywhere");
    } catch {
      show(shareText);
    }
  }

  return (
    <section ref={rootRef} className="rounded-card bg-surface-feature border border-ink-hairline-2 p-6 flex flex-col items-center text-center gap-1">
      <p className="text-cu-secondary font-extrabold tracking-[0.14em] text-action-on-feature-label">
        PLACEMENT TRIO COMPLETE
      </p>
      <div className="flex justify-center gap-1.5 mt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="w-8 h-[5px] rounded-chip bg-win" />
        ))}
      </div>
      <Meta className="mt-2">3 verified games · both teams confirmed</Meta>
      <div
        className="text-cu-hero text-ink mt-4 tabular-nums"
        style={{ filter: settled ? "blur(0px)" : "blur(10px)", transition: "filter 900ms ease" }}
      >
        {text}
      </div>
      <p className="text-cu-secondary font-extrabold tracking-[0.22em] text-ink-muted mt-1">GLASS</p>
      <div className="w-full max-w-[220px] mt-4">
        <div className="flex justify-between text-cu-meta text-ink-muted">
          <span>confidence</span>
          <span>{confDrawn ? confidencePct : 0}%</span>
        </div>
        <div className="h-1.5 rounded-chip bg-ink-hairline-2 mt-1 overflow-hidden">
          <div
            className="h-full rounded-chip bg-action"
            style={{ width: confDrawn ? `${confidencePct}%` : "0%", transition: "width 900ms cubic-bezier(.22,1,.36,1)" }}
          />
        </div>
      </div>
      <p
        className="text-cu-body font-semibold text-win mt-3"
        style={{
          opacity: poured ? 1 : 0,
          transform: poured ? "none" : "translateY(4px)",
          transition: "opacity 500ms ease, transform 500ms ease",
        }}
      >
        Glass poured. Welcome to the table, {displayName}.
      </p>
      {poured && (
        <div className="flex flex-col gap-2 w-full mt-4">
          <Button variant="strong" size="lg" fullWidth onClick={share}>
            Share your Glass
          </Button>
          <button type="button" onClick={onDone} className="text-cu-secondary font-semibold text-ink-muted py-1">
            Continue to your profile
          </button>
        </div>
      )}
    </section>
  );
}
