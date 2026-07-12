"use client";

/**
 * useShellContext — CLIENT-side shell context derivation (fix wave F3).
 *
 * Why this exists: the (app) layout used to resolve ShellContext once per
 * REQUEST (from the x-pathname header) and App Router layouts don't re-render
 * on soft navigation, so any client-side nav (⌘K, g-sequences, plain <Link>
 * clicks crossing contexts) left the rail/sidebar/topbar painting the
 * PREVIOUS location — QA7's stale-chrome blocker. The chrome now derives its
 * context from usePathname() on every navigation; the server-resolved context
 * arrives as `initialContext` so the first client render reproduces the SSR
 * markup byte-for-byte (no hydration mismatch, no flash).
 *
 * The one data-aware edge — /games/[sessionId] belongs to its session's
 * CIRCLE — can't be derived from the path. A module-level cache maps
 * sessionId → circleId (or null for unknown/non-member), seeded from the SSR
 * initialContext and filled on demand by GET /api/shell/session-circle
 * (which repeats the layout's old membership check server-side). While a
 * lookup is in flight the context falls back to home:week, exactly the pure
 * resolver's posture; the cache lives for the tab's life so revisiting a
 * session never refetches.
 */
import { useEffect, useReducer, useRef } from "react";
import { usePathname } from "next/navigation";
import type { ShellContext } from "./contract";
import { gameSessionIdFor, resolveShellContextWithSession } from "@/lib/shell-context";

/** sessionId → circleId (null = unknown session / not a member). Module-level: survives navigations, per-tab. */
const sessionCircleCache = new Map<string, string | null>();

export function useShellContext(initialContext: ShellContext, memberCircleIds: string[]): ShellContext {
  const pathname = usePathname() ?? "/";
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // Seed the cache from the SSR-resolved override exactly once, BEFORE the
  // first derivation below — this is what keeps hydration clean when the
  // hard load itself is a /games/[sessionId] page.
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    const sid = gameSessionIdFor(pathname);
    if (sid && !sessionCircleCache.has(sid)) {
      sessionCircleCache.set(sid, initialContext.kind === "circle" ? initialContext.circleId : null);
    }
  }

  const sessionId = gameSessionIdFor(pathname);
  const needsLookup = sessionId !== null && !sessionCircleCache.has(sessionId);

  useEffect(() => {
    if (!needsLookup || !sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shell/session-circle?id=${encodeURIComponent(sessionId)}`, {
          headers: { accept: "application/json" },
        });
        if (!res.ok) return; // uncached — home:week stands; a later visit retries
        const body = (await res.json()) as { ok?: boolean; circleId?: string | null };
        if (body?.ok !== true) return;
        sessionCircleCache.set(sessionId, typeof body.circleId === "string" ? body.circleId : null);
        if (!cancelled) bump();
      } catch {
        // Network hiccup: leave uncached so the next visit retries.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, needsLookup]);

  return resolveShellContextWithSession(
    pathname,
    (sid) => sessionCircleCache.get(sid),
    (circleId) => memberCircleIds.includes(circleId),
  );
}
