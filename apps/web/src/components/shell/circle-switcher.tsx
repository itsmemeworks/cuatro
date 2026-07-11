"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ShellCircle } from "./contract";

/*
 * Tablet top-bar circle chip + dropdown (design/CUATRO-Web-LATEST.dc.html,
 * "tablet circle switcher dropdown"). Lives in the fixed-dark web chrome, so
 * it pins the design's exact hexes rather than the theme-reactive tokens
 * (see the same note in notif-tray.tsx). Flags/initials/status come
 * pre-derived on ShellCircle — this widget never recomputes them.
 */
const FONT_UI = "var(--font-archivo), sans-serif";
const FONT_MONO = "var(--font-mono), monospace";
const BONE = "#F5F2EC";
const BONE_50 = "rgba(245,242,236,.5)";
const BONE_45 = "rgba(245,242,236,.45)";
const CORAL = "#FF5C3D";
const CHECK_GREEN = "#4BC98B";
const PANEL_BG = "#17150F";
const PANEL_BORDER = "rgba(245,242,236,.14)";
const ROW_HAIRLINE = "rgba(245,242,236,.07)";

function Flag({ circle, size }: { circle: ShellCircle; size: number }) {
  return (
    <span
      aria-hidden
      className="flex items-center justify-center text-white"
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: size >= 28 ? 9 : 8,
        background: circle.color,
        fontFamily: FONT_UI,
        fontWeight: 800,
        fontSize: 10,
      }}
    >
      {circle.emblem ?? circle.initials}
    </span>
  );
}

/** The ◆ home emblem — coral diamond in an outlined square, matching the design's Home row / brand mark. */
function HomeEmblem({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      className="flex items-center justify-center"
      style={{
        width: size,
        height: size,
        flex: "none",
        boxSizing: "border-box",
        borderRadius: size >= 28 ? 9 : 8,
        border: "1px solid rgba(245,242,236,.15)",
        color: CORAL,
        fontFamily: FONT_UI,
        fontWeight: 800,
        fontSize: size >= 28 ? 13 : 12,
      }}
    >
      ◆
    </span>
  );
}

export function CircleSwitcher({ circles, activeCircleId }: { circles: ShellCircle[]; activeCircleId: string | null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const active = activeCircleId ? circles.find((c) => c.id === activeCircleId) ?? null : null;

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

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={active ? `Circle: ${active.name}. Switch circle` : "Switch circle"}
        className="flex cursor-pointer items-center gap-2 transition-cu-state"
        style={{
          padding: "5px 12px 5px 5px",
          borderRadius: 999,
          background: open ? "rgba(245,242,236,.06)" : "transparent",
          border: `1px solid ${open ? "rgba(245,242,236,.16)" : "rgba(245,242,236,.1)"}`,
        }}
      >
        {active ? <Flag circle={active} size={24} /> : <HomeEmblem size={24} />}
        <span style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 11.5, color: BONE }}>
          {active ? active.name : "Circles"}
        </span>
        <span aria-hidden style={{ fontFamily: FONT_UI, fontWeight: 400, fontSize: 10, color: BONE_50 }}>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch circle"
          className="absolute left-0 top-full z-50 mt-2 animate-cu-toast overflow-hidden"
          style={{
            width: 264,
            maxWidth: "calc(100vw - 24px)",
            background: PANEL_BG,
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 14,
            boxShadow: "0 18px 50px rgba(0,0,0,.55)",
          }}
        >
          {circles.map((c) => {
            const isActive = c.id === activeCircleId;
            return (
              <Link
                key={c.id}
                href={`/circles/${c.id}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 transition-cu-state"
                style={{
                  padding: "11px 14px",
                  borderBottom: `1px solid ${ROW_HAIRLINE}`,
                  opacity: isActive ? 1 : 0.55,
                }}
              >
                <Flag circle={c} size={28} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="truncate"
                      style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 12.5, color: BONE }}
                    >
                      {c.name}
                    </span>
                    {c.needsAttention && (
                      <span
                        aria-hidden
                        style={{ width: 6, height: 6, flex: "none", borderRadius: "50%", background: CORAL }}
                      />
                    )}
                  </span>
                  {c.statusLine && (
                    <span
                      className="block tabular-nums"
                      style={{ fontFamily: FONT_MONO, fontWeight: 400, fontSize: 10, color: BONE_45 }}
                    >
                      {c.statusLine}
                    </span>
                  )}
                </span>
                {isActive && (
                  <span aria-hidden style={{ fontFamily: FONT_UI, fontWeight: 700, fontSize: 12, color: CHECK_GREEN }}>
                    ✓
                  </span>
                )}
              </Link>
            );
          })}
          <Link
            href="/home"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 transition-cu-state"
            style={{ padding: "11px 14px" }}
          >
            <HomeEmblem size={28} />
            <span style={{ flex: 1, fontFamily: FONT_UI, fontWeight: 700, fontSize: 12.5, color: BONE }}>
              Home · all Circles
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
