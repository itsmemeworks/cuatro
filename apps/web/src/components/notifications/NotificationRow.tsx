"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationView } from "@/server/notifications";

const TYPE_EMOJI: Record<string, string> = {
  game_filled: "🎾",
  slot_promoted: "⬆️",
  dropout: "🕳️",
  fourth_call: "🔔",
  placement_complete: "🧊",
  result_verified: "📈",
  result_disputed: "⚠️",
  confirm_result: "✅",
  tab_nudge: "💷",
};

/** One notification row. Marks itself read on tap (fire-and-forget), then navigates to its deep link. */
export function NotificationRow({ notification }: { notification: NotificationView }) {
  const router = useRouter();
  const [read, setRead] = useState(notification.read);

  function handleClick() {
    if (!read) {
      setRead(true);
      fetch(`/api/notifications/${notification.id}/read`, { method: "POST" }).catch(() => {});
    }
    router.push(notification.href);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-2xl p-4 flex items-start gap-3 text-left w-full"
      style={{
        background: read ? "var(--c4-bg-elevated)" : "var(--c4-bg-elevated-2)",
        border: `1px solid ${read ? "var(--c4-border)" : "var(--c4-accent)"}`,
      }}
    >
      <span className="text-xl shrink-0" aria-hidden>
        {TYPE_EMOJI[notification.type] ?? "🔔"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium">{notification.title}</p>
        <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
          {notification.body}
        </p>
      </div>
      {!read && (
        <span
          className="w-2 h-2 rounded-full shrink-0 mt-2"
          style={{ background: "var(--c4-accent)" }}
          aria-hidden
        />
      )}
    </button>
  );
}
