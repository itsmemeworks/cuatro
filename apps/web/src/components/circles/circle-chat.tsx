"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

export interface ChatMessage {
  id: string;
  circleId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string; // ISO — serialized at the server-component boundary
}

// Delivery: SSE (see /api/circles/[id]/messages/stream), with the standard
// EventSource auto-reconnect as the only "fallback" — see that route's
// header comment for why a real multi-instance pub/sub isn't needed yet.
export function CircleChat({
  circleId,
  currentUserId,
  initialMessages,
}: {
  circleId: string;
  currentUserId: string;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef(new Set(initialMessages.map((m) => m.id)));

  useEffect(() => {
    const source = new EventSource(`/api/circles/${circleId}/messages/stream`);
    source.addEventListener("message", (event) => {
      const message = JSON.parse((event as MessageEvent<string>).data) as ChatMessage;
      if (seenIds.current.has(message.id)) return;
      seenIds.current.add(message.id);
      setMessages((prev) => [...prev, message]);
    });
    return () => source.close();
  }, [circleId]);

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
      <div ref={listRef} className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "50vh" }}>
        {messages.length === 0 && (
          <p className="text-sm" style={{ color: "var(--c4-text-muted)" }}>
            No messages yet — say hi to the Circle.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.userId === currentUserId;
          return (
            <div
              key={m.id}
              className="rounded-xl px-3 py-2"
              style={{
                background: mine ? "var(--c4-accent)" : "var(--c4-bg-elevated-2)",
                color: mine ? "var(--c4-accent-contrast)" : "var(--c4-text)",
                alignSelf: mine ? "flex-end" : "flex-start",
                maxWidth: "80%",
              }}
            >
              {!mine && <p className="text-xs font-semibold opacity-70">{m.displayName}</p>}
              <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
          placeholder="Message the Circle"
          className="flex-1 rounded-xl px-4 py-3 text-base outline-none"
          style={{
            background: "var(--c4-bg-elevated)",
            border: "1px solid var(--c4-border)",
            color: "var(--c4-text)",
            minHeight: "var(--c4-touch-target)",
          }}
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-xl font-semibold px-4 disabled:opacity-60"
          style={{
            background: "var(--c4-accent)",
            color: "var(--c4-accent-contrast)",
            minHeight: "var(--c4-touch-target)",
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
}
