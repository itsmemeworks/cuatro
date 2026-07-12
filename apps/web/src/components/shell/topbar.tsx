import Link from "next/link";
import type { ShellContext, ShellData } from "./contract";
import { QuickSwitchHint } from "./hotkeys";
import { CircleSwitcher } from "./circle-switcher";
import { NotifTray } from "./notif-tray";

/*
 * Topbar — the tablet (900–1439) shell. One 64px bar: brand, a circle
 * switcher chip, context pills (home: Your week / Discover / The Tab / You;
 * circle: Feed / Chat / Members / Games / ⚙ / Tab), the bell, and the
 * avatar. No rail, no sidebar at this width (design/CUATRO-Web-LATEST.dc.html
 * tablet state). Shown only between 900 and 1440 by the caller (AppShell).
 * Literal dark chrome values, matching the design regardless of OS theme.
 */

const BONE = "#F5F2EC";
const BONE_MUTED = "rgba(245,242,236,.55)";
const TOPBAR_BG = "#171512";
const CORAL = "#FF5C3D";
const MONO = "'IBM Plex Mono',monospace";

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // Hover affordance in classes — inline `background`/`color` would beat
      // stylesheet :hover (Pete, 2026-07-11).
      className={`transition-colors ${active ? "bg-[rgba(245,242,236,.1)] text-[#F5F2EC]" : "text-[rgba(245,242,236,.55)] hover:bg-[rgba(245,242,236,.06)] hover:text-[#F5F2EC]"}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "8px 14px",
        font: "700 12px 'Archivo',sans-serif",
        userSelect: "none",
      }}
    >
      {children}
    </Link>
  );
}

export function Topbar({ data, context, className = "" }: { data: ShellData; context: ShellContext; className?: string }) {
  const isCircle = context.kind === "circle";
  const homeActive = context.kind === "home" ? context.active : "other";
  const circleActive = context.kind === "circle" ? context.active : "other";
  const base = isCircle ? `/circles/${context.circleId}` : "";
  // Chat unread pill in circle context reflects the active circle's flag.
  const activeCircle = isCircle ? data.circles.find((c) => c.id === context.circleId) ?? null : null;

  return (
    <header
      className={className}
      style={{
        alignItems: "center",
        gap: 12,
        padding: "0 22px",
        height: 64,
        borderBottom: "1px solid rgba(245,242,236,.08)",
        background: TOPBAR_BG,
        flex: "none",
      }}
    >
      <Link href="/home" className="transition-opacity hover:opacity-80" style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
        <span style={{ font: "800 15px 'Archivo',sans-serif", color: CORAL }}>◆</span>
        <span style={{ font: "900 15px 'Archivo',sans-serif", letterSpacing: "-.01em", color: BONE }}>CUATRO</span>
      </Link>
      <div style={{ width: 1, height: 24, background: "rgba(245,242,236,.1)" }} />

      <CircleSwitcher circles={data.circles} activeCircleId={isCircle ? context.circleId : null} />

      <span style={{ flex: 1 }} />

      {isCircle ? (
        <div style={{ display: "flex", gap: 4 }}>
          <Pill href={base} active={circleActive === "feed"}>
            Feed
          </Pill>
          <Pill href={`${base}/chat`} active={circleActive === "chat"}>
            Chat
            {(activeCircle?.unreadChatCount ?? 0) > 0 && (
              <span className="tabular-nums" style={{ background: "rgba(255,92,61,.16)", color: "#FF7A5C", borderRadius: 999, padding: "1px 7px", font: "800 10px 'Archivo',sans-serif" }}>
                {(activeCircle?.unreadChatCount ?? 0) > 99 ? "99+" : activeCircle?.unreadChatCount}
              </span>
            )}
          </Pill>
          <Pill href={`${base}/members`} active={circleActive === "members"}>
            Members
          </Pill>
          <Pill href={`${base}/games`} active={circleActive === "games"}>
            Games
          </Pill>
          <Pill href={`${base}/settings`} active={circleActive === "settings"}>
            {/* Labelled like its siblings (QA3): a bare gear was the only unlabelled pill at 1024. */}
            ⚙ Settings
          </Pill>
          <Pill href={`${base}/tab`} active={circleActive === "tab"}>
            Tab
          </Pill>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 4 }}>
          <Pill href="/home" active={homeActive === "week"}>
            Your week
          </Pill>
          <Pill href="/discover" active={homeActive === "discover"}>
            Discover
          </Pill>
          <Pill href="/tab" active={homeActive === "tab"}>
            The Tab
          </Pill>
          <Pill href="/profile" active={homeActive === "you"}>
            You
          </Pill>
        </div>
      )}

      <QuickSwitchHint variant="topbar" />

      <NotifTray unreadCount={data.unreadNotifications} anchor="topbar" />

      <Link href="/profile" aria-label="You" className="transition-opacity hover:opacity-80" style={{ flex: "none" }}>
        {data.identity.avatarUrl ? (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              border: "2px solid rgba(245,242,236,.2)",
              backgroundImage: `url('${data.identity.avatarUrl}')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid rgba(245,242,236,.2)", background: CORAL, color: "#fff", font: `800 12px/28px 'Archivo',sans-serif`, textAlign: "center" }}>
            {data.identity.displayName.trim().slice(0, 1).toUpperCase() || "?"}
          </div>
        )}
      </Link>
    </header>
  );
}
