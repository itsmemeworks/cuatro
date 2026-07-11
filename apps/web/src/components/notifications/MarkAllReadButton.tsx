"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PendingSpinner } from "@/components/ui";

export function MarkAllReadButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="inline-flex cursor-pointer items-center gap-1.5 text-cu-secondary font-semibold text-ink-muted underline underline-offset-2 disabled:opacity-50 transition-cu-state hover:text-ink"
    >
      {pending ? <PendingSpinner /> : null} Mark all read
    </button>
  );
}
