"use client";

import { useState } from "react";

export function InviteShareButton({ inviteCode, circleName }: { inviteCode: string; circleName: string }) {
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
      className="rounded-full px-3 py-2 text-xs font-medium shrink-0"
      style={{ background: "var(--c4-bg-elevated-2)", border: "1px solid var(--c4-border)", color: "var(--c4-text)" }}
    >
      {copied ? "Copied!" : "Invite"}
    </button>
  );
}
