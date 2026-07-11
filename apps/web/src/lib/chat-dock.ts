"use client";

/**
 * Chat-dock coordination state (WEB-SHELL-SPEC.md Wave D, docked chat).
 *
 * Two components in two separate React trees need to agree on where circle
 * chat lives at any moment: DockedChat (components/shell/docked-chat.tsx,
 * mounted by AppShell) and CircleTabs (components/circle-screens/, mounted
 * by the circle pages). This module is their single source of truth:
 *
 *   dock preference  — the user's dock/undock toggle, persisted in
 *                      localStorage (default DOCKED, matching the design's
 *                      first-run state). useSyncExternalStore keeps every
 *                      consumer in both trees in lockstep, including across
 *                      browser tabs via the `storage` event.
 *   desktop gate     — matchMedia(min-width: BP_DESKTOP_MIN). The dock can
 *                      only exist at >= 1440 (the AppShell slot is CSS-gated
 *                      the same way), so "dock ACTIVE" = preference AND gate.
 *
 * SSR/hydration rule: server snapshots are `docked=true` (the majority
 * first paint at desktop) and `wide=false` (a server can't know the
 * viewport). Anything that must assume a width before hydration does it in
 * CSS via min-[1440px]: classes, switching to these hooks' live values once
 * hydrated (see useHydrated) — that keeps the phone markup free of any
 * JS-width switch, per the shell contract.
 */
import { useSyncExternalStore } from "react";
import { BP_DESKTOP_MIN } from "@/components/shell/contract";

const STORAGE_KEY = "cuatro.chatDock";

/** Pure: localStorage raw value -> docked preference. Only an explicit "0" undocks; anything else (null, "1", garbage) is the docked default. */
export function dockPrefFromStorage(raw: string | null): boolean {
  return raw !== "0";
}

const prefListeners = new Set<() => void>();
let storageBound = false;

function readPref(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return dockPrefFromStorage(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return true;
  }
}

function subscribePref(listener: () => void): () => void {
  prefListeners.add(listener);
  if (!storageBound && typeof window !== "undefined") {
    storageBound = true;
    // Another tab toggled the dock — localStorage is already current, just re-read.
    window.addEventListener("storage", (e) => {
      if (e.key === null || e.key === STORAGE_KEY) notifyPref();
    });
  }
  return () => prefListeners.delete(listener);
}

function notifyPref(): void {
  for (const l of [...prefListeners]) l();
}

export function setChatDockPref(docked: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, docked ? "1" : "0");
  } catch {
    // Storage unavailable (private mode etc.) — the toggle still applies for
    // this page's lifetime because the snapshot below reads the live value…
    // except it can't without storage, so fall back silently to default-docked
    // next load. Not worth an error surface.
  }
  notifyPref();
}

/** The persisted dock/undock preference (default docked). Server snapshot: docked. */
export function useChatDockPref(): boolean {
  return useSyncExternalStore(subscribePref, readPref, () => true);
}

let mql: MediaQueryList | null = null;

function getMql(): MediaQueryList {
  if (!mql) mql = window.matchMedia(`(min-width: ${BP_DESKTOP_MIN}px)`);
  return mql;
}

function subscribeWide(listener: () => void): () => void {
  const m = getMql();
  m.addEventListener("change", listener);
  return () => m.removeEventListener("change", listener);
}

/** Live >=1440 viewport gate. Server snapshot: false — pair with min-[1440px]: CSS for pre-hydration width assumptions. */
export function useDesktopWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => getMql().matches, () => false);
}

const noopSubscribe = (): (() => void) => () => {};

/** False during SSR + the hydration pass, true afterwards — for swapping CSS width assumptions to live JS values without a hydration mismatch. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * THE dock coordination rule (single-instance invariant, see
 * docked-chat.tsx): chat renders in the dock iff this is true; the Chat
 * tab's inline CircleChat renders iff this is false. Exactly one of the two
 * mounts once hydrated, so subscribe/mark-read behaviour never doubles.
 */
export function useChatDockActive(): boolean {
  const pref = useChatDockPref();
  const wide = useDesktopWide();
  return pref && wide;
}
