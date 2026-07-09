"use client";

import { useEffect, useRef, useState } from "react";

const AVATAR_PX = 256; // resized client-side before upload — see lib/avatar-storage.ts's header.

/**
 * The Selfie camera screen (design/CUATRO-Prototype-LATEST.dc.html's
 * "Selfie camera" screen) — post-claim avatar capture. Front camera live
 * preview in a dashed-ring circle, snap -> canvas capture -> retake/use.
 * Denied/unavailable camera access degrades gracefully: no video, a short
 * explanation, and a Close — the caller's avatar just stays on its
 * initials fallback (Avatar component already renders those with no
 * `src`), so this is always optional, never a blocker in the claim flow.
 */
export function SelfieCamera({ onClose, onSaved }: { onClose: () => void; onSaved: (avatarUrl: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"starting" | "live" | "denied" | "shot" | "saving">("starting");
  const [shotDataUrl, setShotDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPhase("live");
      } catch {
        if (!cancelled) setPhase("denied");
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function snap() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    // Centre-crop to a square, mirrored to match the preview (front camera
    // feeds render mirrored so the selfie looks like a mirror, not a photo
    // of yourself backwards).
    const side = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - side) / 2;
    const sy = (video.videoHeight - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_PX;
    canvas.height = AVATAR_PX;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.translate(AVATAR_PX, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);

    setShotDataUrl(canvas.toDataURL("image/jpeg", 0.85));
    setPhase("shot");
  }

  function retake() {
    setShotDataUrl(null);
    setPhase("live");
  }

  async function useShot() {
    if (!shotDataUrl) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch("/api/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: shotDataUrl }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError("couldn't save that photo — try again");
        setPhase("shot");
        return;
      }
      onSaved(body.avatarUrl);
    } catch {
      setError("network error — try again");
      setPhase("shot");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-ground flex flex-col" role="dialog" aria-modal="true" aria-label="New avatar">
      <div className="flex items-center justify-between px-5 pt-5 pt-safe">
        <button type="button" onClick={onClose} className="text-cu-body font-bold text-ink-muted">
          ✕ Cancel
        </button>
        <span className="text-cu-meta font-extrabold uppercase tracking-[0.12em] text-ink-muted">New avatar</span>
        <span className="w-[58px]" aria-hidden />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-4.5 px-6">
        <div className="w-[260px] h-[260px] rounded-full overflow-hidden bg-surface border-2 border-dashed border-action relative">
          <video
            ref={videoRef}
            className="w-full h-full object-cover [transform:scaleX(-1)]"
            style={{ display: phase === "live" ? "block" : "none" }}
            playsInline
            muted
          />
          {shotDataUrl && (phase === "shot" || phase === "saving") && (
            // eslint-disable-next-line @next/next/no-img-element -- a locally-captured data URL, not a remote image.
            <img src={shotDataUrl} alt="Your new avatar" className="absolute inset-0 w-full h-full object-cover" />
          )}
          {phase === "denied" && (
            <div className="absolute inset-0 flex items-center justify-center text-center px-6">
              <p className="text-cu-meta text-ink-muted">camera access denied — you can still add a photo later</p>
            </div>
          )}
        </div>
        <p className="text-cu-meta text-ink-muted text-center max-w-[220px]">
          {phase === "denied"
            ? "no camera, no problem — your initials work fine for now"
            : phase === "shot" || phase === "saving"
              ? "looking good"
              : "centre your face in the circle"}
        </p>
        {error && <p className="text-cu-meta text-action text-center">{error}</p>}
      </div>

      <div className="px-5 pb-9 pb-safe">
        {phase === "live" && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={snap}
              aria-label="Take photo"
              className="w-[72px] h-[72px] rounded-full border-4 border-ink flex items-center justify-center"
            >
              <span className="w-[54px] h-[54px] rounded-full bg-action" />
            </button>
          </div>
        )}
        {(phase === "shot" || phase === "saving") && (
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={retake}
              disabled={phase === "saving"}
              className="flex-1 rounded-button border border-ink-hairline-4 text-ink font-semibold text-[13px] py-3.5 disabled:opacity-40"
            >
              Retake
            </button>
            <button
              type="button"
              onClick={useShot}
              disabled={phase === "saving"}
              className="flex-[2] rounded-button bg-action text-action-contrast font-extrabold text-[14px] py-3.5 disabled:opacity-60"
            >
              {phase === "saving" ? "…" : "Use it"}
            </button>
          </div>
        )}
        {phase === "denied" && (
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-button bg-action text-action-contrast font-extrabold text-[14px] py-3.5"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
