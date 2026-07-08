"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The "ambient floodlit-court loop" behind onboarding (design/HANDOFF.md
 * screen 1 + Directions turn 8d): a CSS stand-in for real muted 9:16 court
 * footage — court-line plane on a slow keen-burns drift, a floodlight
 * flicker, and a slow diagonal light sweep, capped with a heavy bottom
 * scrim for text legibility. Ported from the prototype's own keyframes
 * (design/CUATRO-Prototype.dc.html), which live globally in globals.css as
 * `.animate-cu-court-*`.
 *
 * This is always a dark scene regardless of the visitor's OS theme (the
 * footage it stands in for is an always-dark night shoot) — every colour
 * here is a fixed hex from the prototype, not a theme-reactive token.
 *
 * Motion is paused (class removed, not just CSS-suspended) when off-screen
 * or when the tab is hidden, on top of the `prefers-reduced-motion`
 * handling already built into the `.animate-cu-court-*` utilities — see
 * design/HANDOFF.md's motion tokens: "Ambient video pauses off-screen /
 * low-power."
 */
export function AmbientCourtLoop({ className = "" }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [intersecting, setIntersecting] = useState(true);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setIntersecting(entry.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    function onVisibility() {
      setVisible(document.visibilityState === "visible");
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const active = intersecting && visible;

  return (
    <div ref={rootRef} className={`pointer-events-none overflow-hidden ${className}`} aria-hidden>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #10141B, #131210)" }} />
      <div
        className={`absolute left-1/2 top-[30%] w-[330px] h-[250px] -ml-[165px] ${active ? "animate-cu-court-kb" : ""}`}
        style={{ transformOrigin: "50% 20%" }}
      >
        <div className="absolute inset-0 border-2" style={{ borderColor: "rgba(120,170,255,.5)" }} />
        <div className="absolute left-0 right-0 top-1/2 h-[2px]" style={{ background: "rgba(120,170,255,.5)" }} />
        <div className="absolute left-1/2 top-1/2 bottom-0 w-[2px]" style={{ background: "rgba(120,170,255,.5)" }} />
        <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(46,84,150,.28), rgba(46,84,150,.08))" }} />
      </div>
      <div
        className={`absolute left-0 right-0 -top-[50px] h-[220px] ${active ? "animate-cu-court-flick" : ""}`}
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(235,245,255,.35), transparent 65%)" }}
      />
      <div
        className={`absolute top-0 bottom-0 left-0 w-[90px] ${active ? "animate-cu-court-sweep" : ""}`}
        style={{ background: "linear-gradient(90deg, transparent, rgba(235,245,255,.12), transparent)" }}
      />
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg, rgba(19,18,16,.3) 0%, rgba(19,18,16,.42) 34%, rgba(19,18,16,.97) 66%)" }}
      />
    </div>
  );
}
