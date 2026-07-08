"use client";

import { useEffect } from "react";

/**
 * Bottom sheet / modal: device-sheet radius (36 on the top corners),
 * surface background, safe-area-aware bottom padding. Closes on backdrop
 * click or Escape.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-black/50 animate-cu-toast"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md bg-surface rounded-t-[36px] pb-safe animate-cu-seal"
      >
        <div className="mx-auto mt-3 h-1 w-9 rounded-chip bg-ink-hairline-3" aria-hidden />
        <div className="p-5">
          {title && <h2 className="text-cu-card-title text-ink mb-3">{title}</h2>}
          {children}
        </div>
      </div>
    </div>
  );
}
