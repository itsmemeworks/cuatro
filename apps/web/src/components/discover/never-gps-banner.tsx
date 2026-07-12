"use client";

/**
 * First-map-contact reassurance (design/HANDOFF-DELTA-ATLAS.md screen 2). The
 * Atlas is venue-anchored, never device GPS — this card says so out loud the
 * first time a viewer opens the map, then never nags again.
 *
 * It is NOT a nag: once acknowledged (localStorage `cuatro_atlas_gps_ack`) it
 * never re-shows, on this device, ever. It renders nothing until it has read
 * that flag on the client, so there is no SSR flash of a card the viewer has
 * already dismissed.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

const ACK_KEY = "cuatro_atlas_gps_ack";

export function NeverGpsBanner() {
  // `null` = not yet resolved on the client (render nothing); false = show; the
  // banner is gone the instant it is acked or was already acked.
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(ACK_KEY) !== "1");
    } catch {
      // Private-mode / blocked storage: show it (it just can't be persisted).
      setShow(true);
    }
  }, []);

  function ack() {
    try {
      window.localStorage.setItem(ACK_KEY, "1");
    } catch {
      /* storage blocked — dismiss for this view at least */
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      role="note"
      className="pointer-events-auto absolute left-3 right-3 top-3 z-10 mx-auto max-w-[360px] rounded-card border border-ink-hairline-2 bg-surface p-4 animate-cu-arrive"
      style={{ boxShadow: "0 12px 34px rgba(0,0,0,.35)" }}
    >
      <p className="text-[14px] font-extrabold text-ink">This map never asks where you are</p>
      <p className="mt-1.5 text-cu-body leading-relaxed text-ink-muted">
        No GPS, no location permission, no locate-me button. The camera opens on your patch, anchored to your home court.
        Change the court and the patch moves with it.
      </p>
      <div className="mt-3 flex items-center gap-2.5">
        <button
          type="button"
          onClick={ack}
          className="rounded-button bg-strong-bg px-4 py-2 text-[12px] font-bold text-strong-fg transition-cu-state hover:opacity-90 active:opacity-80"
        >
          Understood
        </button>
        <Link
          href="/profile"
          className="text-[12px] font-bold text-ink-muted transition-cu-state hover:text-ink"
        >
          patch settings →
        </Link>
      </div>
    </div>
  );
}
