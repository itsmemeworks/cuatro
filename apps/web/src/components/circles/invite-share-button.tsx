"use client";

import { useEffect, useState } from "react";

export function InviteShareButton({
  inviteCode,
  circleName,
  className = "",
  label = "Copy ↗",
}: {
  inviteCode: string;
  circleName: string;
  className?: string;
  /** Idle label — set to something explicit (e.g. "Invite your group") when a nearly-empty Circle needs the share action spelled out; reverts to "Copied ✓" on tap either way. */
  label?: string;
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
      {copied ? "Copied ✓" : label}
    </button>
  );
}

/**
 * The invite link shown as readable, selectable text — so it can be shared by
 * eye (read aloud at the court, screenshotted) rather than only via a silent
 * clipboard copy. Origin is resolved after mount to avoid an SSR mismatch; the
 * bare path stands in for the first paint.
 */
export function InviteLinkText({ inviteCode, className = "" }: { inviteCode: string; className?: string }) {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  const display = `${origin ? origin.replace(/^https?:\/\//, "") : ""}/join/${inviteCode}`;
  return (
    <span className={`font-mono text-[11px] text-ink-muted break-all select-all ${className}`}>{display}</span>
  );
}
