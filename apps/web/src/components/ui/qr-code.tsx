"use client";

import { useMemo } from "react";
import { QrCode as QrSymbol, Ecc, qrToPath, qrViewBoxSize } from "@/lib/qr/svg";
import { Sheet } from "./sheet";
import { Meta } from "./typography";

// The QR is ALWAYS dark ink on light paper, fixed regardless of the app theme:
// a light-on-dark ("inverted") symbol scans on some readers and not others, and
// a code you show at the court has to work on every phone. These two constants
// are the design's warm ground/ink (globals.css light theme) — pinned here on
// purpose rather than following the theme tokens.
const QR_PAPER = "#faf8f4";
const QR_INK = "#131210";

/**
 * A scannable QR symbol rendered as crisp, resolution-independent SVG (see
 * lib/qr/qrcodegen.ts — a vendored zero-dep encoder). Dark modules on a light
 * paper panel with a generous quiet zone; a small CUATRO wordmark sits beneath.
 * Everything is drawn client-side, so it keeps working offline once the page
 * has loaded.
 */
export function QrCode({
  value,
  ecl = Ecc.MEDIUM,
  size = 240,
  label,
  className = "",
}: {
  value: string;
  ecl?: Ecc;
  /** Max rendered edge in px; the SVG scales to fit and stays crisp at any size. */
  size?: number;
  /** Accessible name for the symbol (screen readers) — defaults to a generic phrase. */
  label?: string;
  className?: string;
}) {
  const { path, dim } = useMemo(() => {
    const qr = QrSymbol.encodeText(value, ecl);
    const border = 4; // quiet zone in modules — the spec minimum, keeps edge scanners happy
    return { path: qrToPath(qr, border), dim: qrViewBoxSize(qr, border) };
  }, [value, ecl]);

  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-card p-4 ${className}`}
      style={{ background: QR_PAPER }}
    >
      <svg
        viewBox={`0 0 ${dim} ${dim}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        role="img"
        aria-label={label ?? "QR code"}
        style={{ maxWidth: "100%", height: "auto" }}
      >
        <path d={path} fill={QR_INK} />
      </svg>
      <span
        className="font-sans font-black text-[13px] leading-none"
        style={{ color: QR_INK, letterSpacing: "-0.02em" }}
        aria-hidden
      >
        CUATRO
      </span>
    </div>
  );
}

/**
 * Bottom-sheet wrapper around {@link QrCode} for the "show this at the court"
 * moment: the big symbol, the Circle (or call) name as the sheet title, and the
 * readable link beneath so it can also be typed or read aloud. Reused by every
 * share surface (circle invite blocks, Fourth Call ring 3).
 */
export function QrShareSheet({
  open,
  onClose,
  title,
  url,
  readableLink,
  caption,
}: {
  open: boolean;
  onClose: () => void;
  /** Sheet heading — the Circle name, or the call context. */
  title: string;
  /** The URL encoded into the QR. */
  url: string;
  /** Human-readable form of the link (e.g. host + path, protocol stripped). Falls back to `url`. */
  readableLink?: string;
  /** One quiet line under the symbol explaining what scanning does. */
  caption?: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col items-center gap-3">
        <QrCode value={url} size={240} label={`QR code to join ${title}`} />
        {caption && (
          <Meta as="p" className="text-center">
            {caption}
          </Meta>
        )}
        <span className="font-mono text-[11px] text-ink-muted break-all select-all text-center">
          {readableLink ?? url}
        </span>
      </div>
    </Sheet>
  );
}
