"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The ambient floodlit-court loop behind onboarding (design/HANDOFF.md
 * screen 1 + Directions turn 8d): real muted 9:16 court footage, full-bleed
 * behind the wordmark, capped with a heavy bottom gradient scrim for text
 * legibility.
 *
 * The CSS court-line plane (court-lines drift, floodlight flicker, light
 * sweep — kept in globals.css as `.animate-cu-court-*`) stays underneath as
 * the poster-frame background: it's what's visible while the video is
 * loading, if it fails to load, and — since the video is never mounted
 * under `prefers-reduced-motion: reduce` — the only thing reduced-motion
 * visitors ever see.
 *
 * This is always a dark scene regardless of the visitor's OS theme (the
 * footage is an always-dark night shoot) — every colour here is a fixed hex
 * from the prototype, not a theme-reactive token.
 *
 * The video pauses (and, under reduced motion, isn't rendered at all) when
 * off-screen or when the tab is hidden — design/HANDOFF.md's motion tokens:
 * "Ambient video pauses off-screen / low-power."
 */
export function AmbientCourtLoop({ className = "" }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [intersecting, setIntersecting] = useState(true);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

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

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    function onChange(e: MediaQueryListEvent) {
      setReducedMotion(e.matches);
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const active = intersecting && visible;
  const showVideo = !reducedMotion && !videoFailed;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !showVideo) return;
    if (active) {
      video.play().catch(() => {
        // Autoplay can be rejected (e.g. low-power mode); the poster frame
        // and CSS court plane behind it still read fine as a static scene.
      });
    } else {
      video.pause();
    }
  }, [active, showVideo]);

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
      {showVideo && (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/video/court-loop-poster.jpg"
          onError={() => setVideoFailed(true)}
        >
          <source src="/video/court-loop.webm" type="video/webm" />
          <source src="/video/court-loop.mp4" type="video/mp4" />
        </video>
      )}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg, rgba(19,18,16,.3) 0%, rgba(19,18,16,.42) 34%, rgba(19,18,16,.97) 66%)" }}
      />
    </div>
  );
}
