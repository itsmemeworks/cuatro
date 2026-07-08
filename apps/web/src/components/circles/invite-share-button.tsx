"use client";

import { useState } from "react";

export function InviteShareButton({
  inviteCode,
  circleName,
  className = "",
}: {
  inviteCode: string;
  circleName: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const url = `${window.location.origin}/join/${inviteCode}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: circleName, url });
        return;
      } catch {
        // User cancelled the share sheet, or the browser rejected the
        // call — fall through to copy-to-clipboard either way.
      }
    }

    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`rounded-chip border border-ink-hairline-3 text-ink font-bold text-[11px] px-3 py-2 shrink-0 transition-cu-state active:opacity-80 ${className}`}
    >
      {copied ? "Copied ✓" : "Copy ↗"}
    </button>
  );
}
