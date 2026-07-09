"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NotificationView } from "@/server/notifications";
import { Meta } from "@/components/ui";

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
      className={`rounded-card p-3.5 flex items-start gap-2.5 text-left w-full border transition-cu-state ${
        read ? "bg-surface border-ink-hairline-1" : "bg-surface-feature border-action/50"
      }`}
    >
      <span className="text-lg shrink-0" aria-hidden>
        {TYPE_EMOJI[notification.type] ?? "🔔"}
      </span>
      <div className="flex-1 min-w-0">
        {/* surface-feature is dark in both themes (see globals.css) — fixed
            bone/muted-bone text when unread, theme-reactive ink otherwise. */}
        <p className={`text-cu-card-title text-[13.5px] ${read ? "text-ink" : "text-[#F5F2EC]"}`}>{notification.title}</p>
        <p className={`text-cu-secondary mt-0.5 ${read ? "text-ink-muted" : ""}`} style={read ? undefined : { color: "rgba(245,242,236,.65)" }}>
          {notification.body}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        {read ? (
          <Meta>{notification.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</Meta>
        ) : (
          <span className="text-cu-meta" style={{ color: "rgba(245,242,236,.45)" }}>
            {notification.createdAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {!read && <span className="w-2 h-2 rounded-full bg-action" aria-hidden />}
      </div>
    </button>
  );
}
