"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ShellCircle } from "./contract";
import { QuickSwitcher, type QuickSwitchEntries } from "./quick-switcher";
import type { QuickSwitchData } from "@/server/quick-switch";
import { resolveShellContext } from "@/lib/shell-context";
import { goHref, goStep, isEditableTarget } from "@/lib/quick-switch";
import { errorCopy } from "@/lib/error-copy";

/*
 * ShellHotkeys — the global keyboard layer (Wave D): ⌘K quick switcher and
 * the g-sequences (g c / g w / g t). Mounted once by AppShell at every width
 * (the listener is cheap; the switcher UI itself only matters ≥900).
 *
 * Exactly ONE global listener, keydown (the Wave D namespacing rule), plus a
 * listener for the namespaced "cuatro:quick-switch-open" CustomEvent so the
 * lead-owned sidebar/topbar can mount a discoverability hint (QuickSwitchHint
 * below) without threading state through the server-rendered chrome. Escape
 * is NEVER bound globally — the switcher handles its own Escape locally
 * (notif-tray, sheets, and the circle switcher already own local handlers).
 *
 * Rules bound here (lib/quick-switch.ts holds the pure logic + tests):
 *   ⌘K / Ctrl+K  toggle, everywhere INCLUDING from inputs.
 *   g then c/w/t within ~1s  navigate (active circle else /circles, /home,
 *     /tab) — suppressed while an input/textarea/select/contentEditable has
 *     focus, and while the switcher itself is open.
 *
 * /api/quick-switch (people + games) is fetched lazily on the FIRST open and
 * cached here — not in the switcher — so it survives close/reopen for the
 * pane's life. Circles arrive on the ShellData prop: zero fetch.
 */

/** Dispatched on window by QuickSwitchHint (and anything else) to open the switcher. */
export const QUICK_SWITCH_OPEN_EVENT = "cuatro:quick-switch-open";

export function ShellHotkeys({ circles }: { circles: ShellCircle[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<QuickSwitchEntries>({ status: "idle", data: null, errorText: null });

  // Refs so the single keydown listener stays stably bound across renders.
  const openRef = useRef(open);
  openRef.current = open;
  const armedAtRef = useRef<number | null>(null);
  const activeCircleIdRef = useRef<string | null>(null);
  {
    const ctx = resolveShellContext(pathname ?? "/");
    activeCircleIdRef.current = ctx.kind === "circle" ? ctx.circleId : null;
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K toggles from anywhere, inputs included.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        armedAtRef.current = null;
        setOpen((o) => !o);
        return;
      }
      // While the switcher is open it owns the keyboard (local handlers).
      if (openRef.current) return;
      const step = goStep(armedAtRef.current, {
        key: e.key,
        now: Date.now(),
        editable: isEditableTarget(e.target as HTMLElement | null),
        hasModifier: e.metaKey || e.ctrlKey || e.altKey,
      });
      armedAtRef.current = step.armedAt;
      if (step.target) {
        e.preventDefault();
        router.push(goHref(step.target, activeCircleIdRef.current));
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(QUICK_SWITCH_OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(QUICK_SWITCH_OPEN_EVENT, onOpenEvent);
    };
  }, [router]);

  const loadEntries = useCallback(async () => {
    setEntries({ status: "loading", data: null, errorText: null });
    try {
      const res = await fetch("/api/quick-switch", { headers: { accept: "application/json" } });
      const json = (await res.json().catch(() => null)) as
        | ({ ok: true } & QuickSwitchData)
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json || json.ok === false) {
        const code = json && json.ok === false ? json.error : res.status === 401 ? "unauthorized" : "network_error";
        setEntries({ status: "error", data: null, errorText: errorCopy(code) });
        return;
      }
      setEntries({ status: "ready", data: { people: json.people, games: json.games }, errorText: null });
    } catch {
      setEntries({ status: "error", data: null, errorText: errorCopy("network_error") });
    }
  }, []);

  // Lazy fetch on FIRST open only (cached for the pane's life); a failed load
  // retries on the next open. Deliberately keyed on `open` alone — the status
  // is read fresh inside so an in-flight/settled fetch never re-triggers.
  useEffect(() => {
    if (open && (entries.status === "idle" || entries.status === "error")) void loadEntries();
    // entries.status intentionally omitted: see comment above.
  }, [open, loadEntries]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  return <QuickSwitcher circles={circles} entries={entries} onClose={() => setOpen(false)} />;
}

/*
 * QuickSwitchHint — the quiet ⌘K discoverability affordance the LEAD mounts
 * in the (lead-owned) sidebar footer and topbar. Client-side because it needs
 * a click handler + platform label; it only dispatches the open event, so the
 * chrome stays server-rendered around it. Fixed-dark literals to match the
 * chrome; hover affordance in classes (CLAUDE.md 7b).
 */
export function QuickSwitchHint({ variant }: { variant: "sidebar" | "topbar" }) {
  // "⌘K" on Apple platforms, "Ctrl K" elsewhere — set after mount so the
  // server-rendered HTML never mismatches.
  const [keyLabel, setKeyLabel] = useState("⌘K");
  useEffect(() => {
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    if (!apple) setKeyLabel("Ctrl K");
  }, []);

  const openSwitcher = () => window.dispatchEvent(new Event(QUICK_SWITCH_OPEN_EVENT));

  if (variant === "topbar") {
    return (
      <button
        type="button"
        onClick={openSwitcher}
        aria-label="Open quick switcher"
        className="cursor-pointer transition-colors text-[rgba(245,242,236,.4)] hover:text-[rgba(245,242,236,.7)] hover:bg-[rgba(245,242,236,.06)]"
        style={{
          font: "600 11px var(--font-mono), monospace",
          border: "1px solid rgba(245,242,236,.15)",
          borderRadius: 6,
          padding: "3px 7px",
          userSelect: "none",
          flex: "none",
        }}
      >
        {keyLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openSwitcher}
      aria-label="Open quick switcher"
      className="cursor-pointer transition-colors hover:bg-[rgba(245,242,236,.05)]"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        margin: "14px 0 10px",
        padding: "7px 12px",
        borderRadius: 11,
        userSelect: "none",
      }}
    >
      <span style={{ font: "400 10px var(--font-mono), monospace", color: "rgba(245,242,236,.4)", flex: 1, textAlign: "left" }}>
        quick switch
      </span>
      <span
        aria-hidden
        style={{
          font: "600 10px var(--font-mono), monospace",
          color: "rgba(245,242,236,.4)",
          border: "1px solid rgba(245,242,236,.15)",
          borderRadius: 6,
          padding: "2px 6px",
        }}
      >
        {keyLabel}
      </span>
    </button>
  );
}
