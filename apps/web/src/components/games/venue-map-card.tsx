"use client";

import { useState } from "react";
import { googleMapsUrl, appleMapsUrl } from "@/lib/directions";

/**
 * The Standing Game screen's "where" block (design/CUATRO-Prototype-LATEST.dc.html,
 * design/DESIGN-AUDIT.md S1): a stylised map-preview tile (CSS court-lines
 * stand-in — no Places API dependency at v0, same reasoning as
 * lib/directions.ts's header) with a coral pin, venue name + mono address,
 * a copy-address chip, Google/Apple Maps buttons, and the dashed "pin to
 * chat" row.
 */
export function VenueMapCard({
  venueName,
  venueAddress,
  pinLocationAction,
}: {
  venueName: string;
  venueAddress: string | null;
  /** Bound server action (session-tab/pin-location's pinVenueLocationAction) — null when there's no venue to pin. */
  pinLocationAction: ((formData: FormData) => Promise<void>) | null;
}) {
  const [copied, setCopied] = useState(false);
  const query = venueAddress || venueName;

  async function copyAddress() {
    await navigator.clipboard.writeText(venueAddress || venueName);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-card border border-ink-hairline-1 bg-surface overflow-hidden">
      <a href={googleMapsUrl(query)} target="_blank" rel="noreferrer" className="block relative h-[110px] overflow-hidden bg-[#171A20]">
        <div className="absolute -left-5 -right-5 top-8 h-3 bg-[#242933] -rotate-6" />
        <div className="absolute -left-5 -right-5 top-[70px] h-2 bg-[#20242D] -rotate-6" />
        <div className="absolute -top-5 -bottom-5 left-[80px] w-2 bg-[#20242D] rotate-12" />
        <div className="absolute -top-5 -bottom-5 left-[210px] w-2.5 bg-[#242933] rotate-12" />
        <div className="absolute left-[60%] top-2 w-20 h-10 rounded-lg bg-win/10 -rotate-6" />
        <div className="absolute left-[6%] top-[76px] w-12 h-7 rounded-md bg-[#3E7BFA]/15 -rotate-6" />
        <div className="absolute left-1/2 top-9 -translate-x-1/2 flex flex-col items-center">
          <div
            className="w-8 h-8 rounded-full bg-action flex items-center justify-center text-action-contrast font-extrabold text-[13px]"
            style={{ borderRadius: "50% 50% 50% 4px", transform: "rotate(-45deg)", boxShadow: "0 4px 14px rgba(255,92,61,.4)" }}
          >
            <span style={{ transform: "rotate(45deg)" }}>{venueName.slice(0, 1).toUpperCase()}</span>
          </div>
          <div className="w-2.5 h-1 rounded-full bg-black/45 mt-0.5" />
        </div>
        <span className="absolute right-2.5 bottom-2 font-mono text-[8.5px] text-ink-muted">map preview</span>
      </a>

      <div className="p-3.5 flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex-1 min-w-0">
            <p className="text-cu-body font-bold text-ink truncate">{venueName}</p>
            {venueAddress && <p className="font-mono text-[10.5px] text-ink-muted mt-0.5 truncate">{venueAddress}</p>}
          </div>
          <button
            type="button"
            onClick={copyAddress}
            className="shrink-0 rounded-chip border border-ink-hairline-3 text-ink font-bold text-[10.5px] px-3 py-1.5 transition-cu-state active:opacity-80"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>

        <div className="flex gap-2">
          <a
            href={googleMapsUrl(query)}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-button bg-ink-hairline-1 border border-ink-hairline-2 text-ink text-[11.5px] font-bold py-2.5 text-center"
          >
            Google Maps
          </a>
          <a
            href={appleMapsUrl(query)}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-button bg-ink-hairline-1 border border-ink-hairline-2 text-ink text-[11.5px] font-bold py-2.5 text-center"
          >
            Apple Maps
          </a>
        </div>

        {pinLocationAction && (
          <form action={pinLocationAction}>
            <button
              type="submit"
              className="w-full rounded-button border border-dashed border-action text-action-strong text-[11.5px] font-bold py-2.5 text-center transition-cu-state active:opacity-80"
            >
              📍 Pin location to the Lot&apos;s chat
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
