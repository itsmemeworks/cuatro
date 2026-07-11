"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { NotificationDayGroup, NotificationView } from "@/server/notifications";
import { errorCopy } from "@/lib/error-copy";
import { PendingSpinner } from "@/components/ui";
import {
  fetchVapidPublicKey,
  pushSupported,
  trayPushRowState,
  usePushSubscribe,
} from "@/lib/use-push-subscribe";

/*
 * The web shell chrome (rail/sidebar/topbar) is a fixed-dark frame in BOTH
 * themes — see design/CUATRO-Web-LATEST.dc.html. The bell and its tray live
 * in that chrome, so they mirror the design's exact hexes (the same reason
 * NotificationRow pins bone/coral on the fixed-dark feature surface) rather
 * than the theme-reactive tokens. Values lifted from the design's
 * "Notifications tray" screen.
 */
const FONT_UI = "var(--font-archivo), sans-serif";
const FONT_MONO = "var(--font-mono), monospace";
const BONE = "#F5F2EC";
const BONE_55 = "rgba(245,242,236,.55)";
const BONE_45 = "rgba(245,242,236,.45)";
const BONE_35 = "rgba(245,242,236,.35)";
const CORAL = "#FF5C3D";
const PANEL_BG = "#17150F";
const PANEL_BORDER = "rgba(245,242,236,.14)";
const ROW_HAIRLINE = "rgba(245,242,236,.07)";

/**
 * Short, mono timestamp for a tray row (the design shows "18:12" for today,
 * "Fri" for earlier this week, a short date beyond). London calendar day, to
 * match the notifications page's day grouping.
 */
function shortStamp(date: Date, now: Date = new Date()): string {
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  if (dayKey(date) === dayKey(now)) {
    return date.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
  }
  const ageDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (ageDays < 7) {
    return date.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short" });
  }
  return date.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" });
}

/** Badge label per the unread-badge law (pill everywhere); caps so the pill never stretches. */
function badgeLabel(n: number): string {
  return n > 99 ? "99+" : String(n);
}

interface TrayState {
  status: "idle" | "loading" | "ready" | "error";
  rows: NotificationView[];
  error: string | null;
}

/**
 * "Not now" (or a denied permission prompt) parks the tray's enable row on
 * this device for good — never ask twice. Device-scoped like the browser
 * permission itself, so no user id in the key.
 */
const PUSH_DISMISS_KEY = "cuatro:push-tray-dismissed";

type PushPhase = "idle" | "pending" | "enabled" | "denied" | "error";

export function NotifTray({ unreadCount, anchor }: { unreadCount: number; anchor: "rail" | "topbar" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Badge/"N new" count: seeded from the server render, corrected once the
  // tray loads, decremented as rows are opened (and thus marked read).
  const [unread, setUnread] = useState(unreadCount);
  const [tray, setTray] = useState<TrayState>({ status: "idle", rows: [], error: null });
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  // Quiet browser-notifications enable row (spec item 5). Enrolment flow is
  // the shared hook (lib/use-push-subscribe.ts, same one the profile toggle
  // uses); this block only decides whether and how the row shows. Dismissed
  // starts true so the server render and first client paint agree (hidden)
  // until localStorage has actually been consulted.
  const push = usePushSubscribe();
  const [pushPhase, setPushPhase] = useState<PushPhase>("idle");
  const [pushDismissed, setPushDismissed] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  // undefined = not fetched yet (row stays hidden, never stubbed).
  const [serverKey, setServerKey] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!pushSupported()) return;
    setPermission(Notification.permission);
    try {
      setPushDismissed(window.localStorage.getItem(PUSH_DISMISS_KEY) != null);
    } catch {
      // Storage unavailable: leave dismissed=true, the row just stays quiet.
    }
  }, []);

  // Ask the server for its VAPID public key lazily, on first open, and only
  // once every cheaper gate says the row could show. A null/absent key hides
  // the row entirely.
  useEffect(() => {
    if (!open || serverKey !== undefined) return;
    if (!push.supported || pushDismissed || push.subscribed || permission === "denied") return;
    let stale = false;
    void fetchVapidPublicKey().then((key) => {
      if (!stale) setServerKey(key);
    });
    return () => {
      stale = true;
    };
  }, [open, serverKey, push.supported, pushDismissed, push.subscribed, permission]);

  const pushOffer =
    pushPhase === "idle" &&
    trayPushRowState({
      supported: push.supported,
      permission,
      subscribed: push.subscribed,
      dismissed: pushDismissed,
      serverKey: serverKey ?? null,
    }) === "offer";

  async function enablePush() {
    if (pushPhase === "pending") return;
    setPushPhase("pending");
    const result = await push.enable();
    if (result === "subscribed") {
      setPushPhase("enabled");
      return;
    }
    if (result === "denied") {
      // The browser said no. Park the row for good (never ask twice) and
      // leave one quiet line about where to change their mind.
      try {
        window.localStorage.setItem(PUSH_DISMISS_KEY, "1");
      } catch {}
      setPermission("denied");
      setPushPhase("denied");
      return;
    }
    setPushPhase("error");
  }

  function dismissPush() {
    try {
      window.localStorage.setItem(PUSH_DISMISS_KEY, "1");
    } catch {}
    setPushDismissed(true);
    setPushPhase("idle");
  }

  useEffect(() => {
    setUnread(unreadCount);
  }, [unreadCount]);

  const load = useCallback(async () => {
    setTray((t) => ({ ...t, status: "loading", error: null }));
    try {
      const res = await fetch("/api/notifications", { headers: { accept: "application/json" } });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; groups: NotificationDayGroup[]; unreadCount: number }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        const code = json && json.ok === false ? json.error : res.status === 401 ? "unauthorized" : "network_error";
        setTray({ status: "error", rows: [], error: errorCopy(code) });
        return;
      }
      // The API returns rows grouped by day, newest-first; the tray is a flat
      // list (day labels live on the full /notifications page), so flatten.
      // createdAt arrives as a JSON string over the wire — rehydrate to Date.
      const rows = json.groups.flatMap((g) => g.notifications.map((n) => ({ ...n, createdAt: new Date(n.createdAt) })));
      setReadIds(new Set());
      setTray({ status: "ready", rows, error: null });
      setUnread(json.unreadCount);
    } catch {
      setTray({ status: "error", rows: [], error: errorCopy("network_error") });
    }
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && tray.status === "idle") void load();
  }

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openRow(n: NotificationView) {
    const alreadyRead = n.read || readIds.has(n.id);
    if (!alreadyRead) {
      setReadIds((prev) => new Set(prev).add(n.id));
      setUnread((u) => Math.max(0, u - 1));
      // Fire-and-forget, same as the notifications page's row.
      fetch(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
    }
    setOpen(false);
    router.push(n.href);
  }

  const isRail = anchor === "rail";
  // Rail bell sits at the bottom-left of the 76px rail: open the panel to the
  // right of the rail, bottom-aligned. Topbar bell sits top-right: drop the
  // panel below it, right-aligned. Both stay clear of the viewport edges.
  const panelPosition = isRail ? "bottom-0 left-full ml-3" : "top-full right-0 mt-2";

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative cursor-pointer rounded-full transition-cu-state hover:bg-[rgba(245,242,236,.08)]"
        style={{ padding: isRail ? 6 : 4, lineHeight: 0 }}
      >
        <svg
          width={isRail ? 20 : 19}
          height={isRail ? 20 : 19}
          viewBox="0 0 24 24"
          fill="none"
          stroke={isRail ? "rgba(245,242,236,.6)" : "rgba(245,242,236,.65)"}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5" />
          <path d="M10 19.5a2.2 2.2 0 0 0 4 0" />
        </svg>
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute rounded-chip tabular-nums"
            style={{
              top: isRail ? 0 : -2,
              right: isRail ? -2 : -4,
              background: CORAL,
              color: "#fff",
              padding: "1px 5px",
              fontFamily: FONT_UI,
              fontWeight: 800,
              fontSize: 10,
            }}
          >
            {badgeLabel(unread)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={`absolute z-50 animate-cu-toast flex flex-col ${panelPosition}`}
          style={{
            width: 372,
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "min(70vh, 560px)",
            background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 16,
            boxShadow: "0 18px 50px rgba(0,0,0,.55)",
            overflow: "hidden",
          }}
        >
          <div
            className="flex items-center gap-2.5 shrink-0"
            style={{ padding: "13px 16px", borderBottom: "1px solid rgba(245,242,236,.08)" }}
          >
            <span style={{ flex: 1, fontFamily: FONT_UI, fontWeight: 800, fontSize: 13, color: BONE }}>Notifications</span>
            {unread > 0 && (
              <span className="tabular-nums" style={{ fontFamily: FONT_MONO, fontWeight: 400, fontSize: 10, color: CORAL }}>
                {unread} new
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close notifications"
              className="cursor-pointer transition-cu-state hover:opacity-70"
              style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 12, color: "rgba(245,242,236,.5)" }}
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {tray.status === "loading" && (
              <p style={{ padding: 16, fontFamily: FONT_MONO, fontWeight: 400, fontSize: 11, color: BONE_45 }}>Loading</p>
            )}
            {tray.status === "error" && (
              <p style={{ padding: 16, fontFamily: FONT_UI, fontWeight: 400, fontSize: 11, color: BONE_55 }}>{tray.error}</p>
            )}
            {tray.status === "ready" && tray.rows.length === 0 && (
              <div style={{ padding: "18px 16px" }}>
                <p style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 12.5, color: BONE }}>Nothing here yet</p>
                <p style={{ fontFamily: FONT_UI, fontWeight: 400, fontSize: 11, color: BONE_55, marginTop: 2 }}>
                  RSVP openings, Fourth Calls, and Glass movement show up here.
                </p>
              </div>
            )}
            {tray.status === "ready" &&
              tray.rows.map((n, i) => {
                const read = n.read || readIds.has(n.id);
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openRow(n)}
                    className="flex w-full cursor-pointer items-start gap-2.5 text-left transition-cu-state hover:bg-[rgba(245,242,236,.04)]"
                    style={{
                      padding: "12px 16px",
                      borderBottom: i === tray.rows.length - 1 ? "none" : `1px solid ${ROW_HAIRLINE}`,
                      opacity: read ? 0.55 : 1,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 7,
                        height: 7,
                        marginTop: 5,
                        flex: "none",
                        borderRadius: "50%",
                        background: read ? "transparent" : CORAL,
                      }}
                    />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="block" style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 12.5, color: BONE }}>
                        {n.title}
                      </span>
                      <span
                        className="block"
                        style={{ fontFamily: FONT_UI, fontWeight: 400, fontSize: 11, color: BONE_55, marginTop: 2 }}
                      >
                        {n.body}
                      </span>
                    </span>
                    <span
                      className="tabular-nums shrink-0"
                      style={{ fontFamily: FONT_MONO, fontWeight: 400, fontSize: 10, color: BONE_35 }}
                    >
                      {shortStamp(n.createdAt)}
                    </span>
                  </button>
                );
              })}
          </div>

          {/* Quiet browser-notifications enable row (design's tray footer
              strip). Hidden entirely unless the browser can push, the server
              has a VAPID key, this device isn't subscribed, and the player
              hasn't said "not now" — never stubbed, never asked twice. */}
          {(pushOffer || pushPhase !== "idle") && (
            <div
              className="shrink-0"
              style={{
                padding: "11px 16px",
                background: "rgba(245,242,236,.04)",
                borderBottom: "1px solid rgba(245,242,236,.08)",
                fontFamily: FONT_MONO,
                fontWeight: 400,
                fontSize: 10.5,
                color: BONE_45,
              }}
            >
              {pushOffer && (
                <>
                  desktop can ping you when a slot opens ·{" "}
                  <button
                    type="button"
                    onClick={() => void enablePush()}
                    className="cursor-pointer transition-cu-state hover:opacity-70"
                    style={{ font: "inherit", color: "#FF7A5C", fontWeight: 700 }}
                  >
                    enable browser notifications
                  </button>{" "}
                  ·{" "}
                  <button
                    type="button"
                    onClick={dismissPush}
                    className="cursor-pointer transition-cu-state hover:text-[rgba(245,242,236,.75)]"
                    style={{ font: "inherit", color: "inherit" }}
                  >
                    not now
                  </button>
                </>
              )}
              {pushPhase === "pending" && (
                <span className="inline-flex items-center gap-1.5">
                  <PendingSpinner />
                  switching on browser notifications
                </span>
              )}
              {pushPhase === "enabled" && <>this desktop will ping you when a slot opens</>}
              {pushPhase === "denied" && (
                <>your browser has notifications blocked for CUATRO. You can change that in its site settings</>
              )}
              {pushPhase === "error" && (
                <>
                  {errorCopy("something_went_wrong")}{" "}
                  <button
                    type="button"
                    onClick={() => void enablePush()}
                    className="cursor-pointer transition-cu-state hover:opacity-70"
                    style={{ font: "inherit", color: "#FF7A5C", fontWeight: 700 }}
                  >
                    enable browser notifications
                  </button>{" "}
                  ·{" "}
                  <button
                    type="button"
                    onClick={dismissPush}
                    className="cursor-pointer transition-cu-state hover:text-[rgba(245,242,236,.75)]"
                    style={{ font: "inherit", color: "inherit" }}
                  >
                    not now
                  </button>
                </>
              )}
            </div>
          )}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="shrink-0 bg-[rgba(245,242,236,.04)] transition-cu-state hover:bg-[rgba(245,242,236,.08)]"
            style={{
              padding: "11px 16px",
              fontFamily: FONT_MONO,
              fontWeight: 400,
              fontSize: 10.5,
              color: BONE_45,
            }}
          >
            see all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
