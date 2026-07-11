import Link from "next/link";
import type { ShellContext, ShellData } from "./contract";
import { NotifTray } from "./notif-tray";

/*
 * Rail — the 76px desktop-only icon rail (design/CUATRO-Web-LATEST.dc.html,
 * "rail: home + circles"). Home diamond, a hairline, one flag per circle,
 * the create "+", a spacer, the bell (notif tray), and the vertical CIRCLES
 * label. Hidden below 1440 by the caller (AppShell). Colours are the
 * design's literal dark chrome values (#100F0D ground, #F5F2EC bone,
 * #FF5C3D coral) — the desktop shell is a dark environment in the
 * authoritative design regardless of the viewer's OS theme.
 *
 * DESIGN LAW notes honoured here: the create "+" is a plain bone-outlined
 * tile, NOT a dashed coral circle (dashed coral = a space waiting for a
 * person, only). Circle flags carry no numeric badge on the rail; unread /
 * needs-answer surface in the sidebar rows, matching the design.
 */

const BONE = "#F5F2EC";
const RAIL_BG = "#100F0D";
const CORAL = "#FF5C3D";
const HAIR = "rgba(245,242,236,.12)";

function ActiveBar({ on }: { on: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: -16,
        top: 10,
        bottom: 10,
        width: 4,
        borderRadius: 99,
        background: BONE,
        opacity: on ? 1 : 0,
        transition: "opacity 200ms",
      }}
    />
  );
}

export function Rail({ data, context, className = "" }: { data: ShellData; context: ShellContext; className?: string }) {
  const homeActive = context.kind === "home";
  const activeCircleId = context.kind === "circle" ? context.circleId : null;

  return (
    <nav
      aria-label="Circles"
      className={className}
      style={{
        width: 76,
        flex: "none",
        background: RAIL_BG,
        borderRight: "1px solid rgba(245,242,236,.06)",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 0",
        gap: 12,
      }}
    >
      <Link href="/home" aria-label="Home" aria-current={homeActive ? "page" : undefined} style={{ position: "relative", userSelect: "none" }}>
        <ActiveBar on={homeActive} />
        {/* Hover states live in classes — inline `background`/`opacity` would beat stylesheet :hover (Pete, 2026-07-11). */}
        <div
          className={`transition-colors ${homeActive ? "bg-[rgba(245,242,236,.08)]" : "hover:bg-[rgba(245,242,236,.06)]"}`}
          style={{
            width: 46,
            height: 46,
            borderRadius: 15,
            border: `1px solid ${HAIR}`,
            color: CORAL,
            font: "800 19px/46px 'Archivo',sans-serif",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          ◆
        </div>
      </Link>

      <div style={{ width: 26, height: 1, background: HAIR }} />

      {data.circles.map((c) => {
        const active = c.id === activeCircleId;
        return (
          <Link
            key={c.id}
            href={`/circles/${c.id}`}
            aria-label={c.name}
            aria-current={active ? "page" : undefined}
            style={{ position: "relative", userSelect: "none" }}
          >
            <ActiveBar on={active} />
            <div
              className={`transition-opacity ${active ? "" : "opacity-[.45] hover:opacity-90"}`}
              style={{
                width: 46,
                height: 46,
                borderRadius: 15,
                background: c.color,
                color: "#fff",
                font: "800 15px/46px 'Archivo',sans-serif",
                textAlign: "center",
              }}
            >
              {c.emblem ?? c.initials}
            </div>
          </Link>
        );
      })}

      <Link
        href="/circles/new"
        aria-label="Create a Circle"
        className="bg-[rgba(245,242,236,.04)] transition-colors hover:bg-[rgba(245,242,236,.1)]"
        style={{
          width: 46,
          height: 46,
          borderRadius: 15,
          border: "1px solid rgba(245,242,236,.18)",
          color: "rgba(245,242,236,.7)",
          font: "600 19px/44px 'Archivo',sans-serif",
          textAlign: "center",
          boxSizing: "border-box",
          userSelect: "none",
        }}
      >
        +
      </Link>

      <span style={{ flex: 1 }} />

      <NotifTray unreadCount={data.unreadNotifications} anchor="rail" />

      <div
        aria-hidden
        style={{
          font: "400 10px 'IBM Plex Mono',monospace",
          color: "rgba(245,242,236,.3)",
          writingMode: "vertical-rl",
          letterSpacing: ".14em",
        }}
      >
        CIRCLES
      </div>
    </nav>
  );
}
