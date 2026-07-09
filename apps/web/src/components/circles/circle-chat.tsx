"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useCircleLive } from "@/lib/realtime/hooks";
import { isChatBackfillEvent } from "@/lib/realtime/channels";
import { Meta } from "@/components/ui";

export interface ChatMessage {
  id: string;
  circleId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string; // ISO — serialized at the server-component boundary
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// Delivery: the circle's realtime broadcast channel carries only
// {type: "message", messageId, ts} — never the body — so a "message" event
// (or a synthesized "reconnect", see lib/realtime/hooks.ts) triggers a
// backfill fetch through GET .../messages?after=<last-known-timestamp>,
// which doubles as both "append the new message" and "catch up on anything
// missed while offline". Any other event type on this channel (rsvp, match,
// tab — the same circle page also shows sessions/tab summaries) falls
// through to a plain router.refresh() so the rest of the page stays live
// too, without a second subscription to the same topic.
export function CircleChat({
  circleId,
  currentUserId,
  initialMessages,
}: {
  circleId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set(initialMessages.map((m) => m.id)));
  const lastSeenAtRef = useRef(
    initialMessages.reduce((max, m) => Math.max(max, new Date(m.createdAt).getTime()), 0),
  );

  // Best-effort — a failed mark-read just leaves the unread count stale
  // until the next mount/message; never blocks the chat itself.
  const markRead = useCallback(() => {
    fetch(`/api/circles/${circleId}/read`, { method: "POST" }).catch(() => {});
  }, [circleId]);

  const backfill = useCallback(async () => {
    try {
      const res = await fetch(`/api/circles/${circleId}/messages?after=${lastSeenAtRef.current}`);
      if (!res.ok) return;
      const body = (await res.json()) as { ok: boolean; messages?: ChatMessage[] };
      if (!body.ok || !body.messages?.length) return;
      const fresh = body.messages.filter((m) => !seenIds.current.has(m.id));
      if (fresh.length === 0) return;
      for (const m of fresh) {
        seenIds.current.add(m.id);
        lastSeenAtRef.current = Math.max(lastSeenAtRef.current, new Date(m.createdAt).getTime());
      }
      setMessages((prev) => [...prev, ...fresh]);
      // This chat view is open and just took on a new message — it counts
      // as read the instant it lands, same as messaging apps' "read while
      // looking at the thread" behaviour.
      markRead();
    } catch {
      // Best-effort — the next live event (or a manual refresh) will retry.
    }
  }, [circleId, markRead]);

  useCircleLive(circleId, (event) => {
    if (isChatBackfillEvent(event)) backfill();
    else router.refresh();
  });

  // Mount-time: catch up on anything posted between the server render and
  // the socket subscribing above, and mark the circle read for having
  // opened the chat view at all (design/DESIGN-AUDIT.md F3).
  useEffect(() => {
    backfill();
    markRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      const res = await fetch(`/api/circles/${circleId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const { message } = (await res.json()) as { message: ChatMessage };
        if (!seenIds.current.has(message.id)) {
          seenIds.current.add(message.id);
          setMessages((prev) => [...prev, message]);
        }
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={listRef} className="flex flex-col gap-2.5 overflow-y-auto px-1" style={{ maxHeight: "55vh" }}>
        {messages.length === 0 && <p className="text-cu-body text-ink-muted">No messages yet — say hi to the Circle.</p>}
        {messages.map((m) => {
          const mine = m.userId === currentUserId;
          return (
            <div key={m.id} className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
              {!mine && (
                <span className="text-cu-meta text-ink-muted px-1">{m.displayName}</span>
              )}
              <div
                className={`max-w-[80%] rounded-card px-3.5 py-2.5 text-cu-body ${
                  mine
                    ? "bg-action text-action-contrast rounded-br-md"
                    : "bg-surface border border-ink-hairline-2 text-ink rounded-bl-md"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              </div>
              <Meta as="span" className="px-1">
                {timeLabel(m.createdAt)}
              </Meta>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 items-center">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          placeholder="Message the Circle…"
          className="flex-1 min-h-11 rounded-chip px-4 py-3 text-[13px] outline-none bg-surface border border-ink-hairline-3 text-ink placeholder:text-ink-muted"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          aria-label="Send"
          className="w-11 h-11 rounded-full bg-action text-action-contrast font-extrabold text-lg shrink-0 flex items-center justify-center transition-cu-state active:opacity-80 disabled:opacity-40"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
