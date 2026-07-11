"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Sheet, Avatar, Meta } from "@/components/ui";

// Mirrors server/comments.ts's MAX_COMMENT_LENGTH — kept as a literal here
// rather than imported, since that module pulls in @cuatro/db/better-sqlite3
// and must never enter a client bundle (same reasoning as circle-chat.tsx's
// hardcoded maxLength for circles.ts's MAX_MESSAGE_LENGTH).
const MAX_COMMENT_LENGTH = 1000;

export interface CommentSheetItem {
  id: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string; // ISO
}

/**
 * Minimal 💬 thread (design/DESIGN-AUDIT.md F1): a Sheet with the full
 * comment list + a composer. Functional-minimal on purpose — the
 * pixel-perfect pass owns spacing/typography; this just has to fetch, post,
 * and keep the parent's chip count in sync.
 */
export function CommentSheet({
  matchId,
  open,
  onClose,
  onCountChange,
}: {
  matchId: string;
  open: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
}) {
  const [comments, setComments] = useState<CommentSheetItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`/api/matches/${matchId}/comments`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body.error ?? "failed");
        setComments(body.comments);
        onCountChange(body.comments.length);
      })
      .catch(() => setError("Couldn't load comments."))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matchId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        setError(result.error ?? "Couldn't post that.");
        return;
      }
      setDraft("");
      setComments((prev) => {
        const next = [...prev, result.comment];
        onCountChange(next.length);
        return next;
      });
    } catch {
      setError("Network error, try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Comments">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2.5 overflow-y-auto" style={{ maxHeight: "50vh" }}>
          {loading && <Meta as="p">Loading…</Meta>}
          {!loading && comments.length === 0 && <Meta as="p">No comments yet.</Meta>}
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2.5">
              <Avatar src={c.avatarUrl} name={c.displayName} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-cu-body">
                  <span className="font-bold text-ink">{c.displayName}</span>{" "}
                  <span className="text-ink">{c.body}</span>
                </p>
                <Meta as="span">{new Date(c.createdAt).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Meta>
              </div>
            </div>
          ))}
        </div>

        {error && <Meta tone="action">{error}</Meta>}

        <form onSubmit={handleSubmit} className="flex gap-2 items-center">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_COMMENT_LENGTH}
            placeholder="Add a comment…"
            className="flex-1 min-h-11 rounded-chip px-4 py-3 text-[13px] outline-none bg-surface border border-ink-hairline-3 text-ink placeholder:text-ink-muted"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            aria-label="Post comment"
            className="w-11 h-11 rounded-full bg-action text-action-contrast font-extrabold text-lg shrink-0 flex items-center justify-center transition-cu-state active:opacity-80 disabled:opacity-40"
          >
            ↑
          </button>
        </form>
      </div>
    </Sheet>
  );
}
