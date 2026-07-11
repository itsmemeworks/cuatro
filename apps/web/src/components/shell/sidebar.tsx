import Link from "next/link";
import type { ShellCircle, ShellContext, ShellData } from "./contract";

/*
 * Sidebar — the 236px desktop-only context sidebar
 * (design/CUATRO-Web-LATEST.dc.html). Two faces:
 *   home context   → CUATRO wordmark, Your week / Discover / The Tab / You,
 *                    then a YOUR CIRCLES list.
 *   circle context → ‹ Home, circle header, Feed / Chat / Members / Games /
 *                    Tab / Settings, an "Invite a mate" card.
 * Both share the footer identity card and the mono "no fees · no ads · no
 * dark patterns" line. Hidden below 1440 by the caller (AppShell). Literal
 * dark chrome values (the desktop shell is dark in the authoritative design
 * regardless of OS theme); coral active bar per the design.
 */

const BONE = "#F5F2EC";
const BONE_MUTED = "rgba(245,242,236,.55)";
const SIDEBAR_BG = "#171512";
const CORAL = "#FF5C3D";
const CORAL_STRONG = "#FF7A5C";
const LOSS = "#E56B4F";
const WIN = "#4BC98B";
const MONO = "'IBM Plex Mono',monospace";

function NavRow({
  href,
  active,
  label,
  icon,
  trailing,
}: {
  href: string;
  active: boolean;
  label: string;
  icon: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const c = active ? BONE : BONE_MUTED;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // Hover affordance lives in classes, not the style object — inline
      // `background` would beat any stylesheet :hover (Pete, 2026-07-11).
      className={`transition-colors ${active ? "bg-[rgba(245,242,236,.06)]" : "hover:bg-[rgba(245,242,236,.05)]"}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "10px 12px",
        borderRadius: 12,
        position: "relative",
        userSelect: "none",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: -14,
          top: 9,
          bottom: 9,
          width: 3,
          borderRadius: 99,
          background: CORAL,
          opacity: active ? 1 : 0,
          transition: "opacity 200ms",
        }}
      />
      <span aria-hidden style={{ display: "flex", color: c }}>
        {icon}
      </span>
      <span style={{ font: "700 13px 'Archivo',sans-serif", color: c, flex: 1, transition: "color 200ms" }}>{label}</span>
      {trailing}
    </Link>
  );
}

function icon(paths: React.ReactNode) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths}
    </svg>
  );
}

const ICONS = {
  week: icon(
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="3.5" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="20.5" y2="12" />
    </>,
  ),
  discover: icon(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.5 8.5l-2.2 5-5 2.2 2.2-5z" />
    </>,
  ),
  tab: icon(
    <>
      <path d="M6.5 3.5h11v17l-1.85-1.3-1.83 1.3-1.82-1.3-1.82 1.3-1.83-1.3-1.85 1.3z" />
      <line x1="9.5" y1="8.5" x2="14.5" y2="8.5" />
      <line x1="9.5" y1="12" x2="14.5" y2="12" />
    </>,
  ),
  feed: icon(
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="12" y2="17" />
    </>,
  ),
  chat: icon(<path d="M20 11.5a8 8 0 1 0-3.2 6.4L20.5 19l-.9-3.4A7.96 7.96 0 0 0 20 11.5z" />),
  members: icon(
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
      <circle cx="16.5" cy="9.5" r="2.8" />
      <path d="M16 14.7c2.3.2 4 1.6 4.5 4.3" />
    </>,
  ),
  games: icon(
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="9" y1="3.5" x2="9" y2="6.5" />
      <line x1="15" y1="3.5" x2="15" y2="6.5" />
    </>,
  ),
  settings: icon(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 4v2.2M12 17.8V20M4 12h2.2M17.8 12H20M6.3 6.3l1.6 1.6M16.1 16.1l1.6 1.6M6.3 17.7l1.6-1.6M16.1 7.9l1.6-1.6" />
    </>,
  ),
};

/** Mono net-balance chip for a Tab row (loss/coral when owing, win/green when owed). */
function TabNet({ line, owing }: { line: string | null; owing: boolean }) {
  if (!line) return null;
  return <span style={{ font: `700 11px ${MONO}`, color: owing ? LOSS : WIN }}>{line}</span>;
}

/** Small coral dot for a nav row that needs attention. */
function Dot() {
  return <span aria-hidden style={{ width: 7, height: 7, borderRadius: "50%", background: CORAL }} />;
}

/** Caps a badge count so the pill never stretches (matches the notif tray). */
function badgeLabel(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Numeric unread-chat pill (coral) — the design's Chat-row badge; null-renders at zero. */
function UnreadPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="tabular-nums"
      style={{ background: "rgba(255,92,61,.16)", color: CORAL_STRONG, borderRadius: 999, padding: "2px 8px", font: "800 10px 'Archivo',sans-serif" }}
    >
      {badgeLabel(count)}
    </span>
  );
}

/** Green count pill for the Discover row — open games near the viewer's patch; hidden when null or zero. */
function DiscoverBadge({ count }: { count: number | null | undefined }) {
  if (count == null || count <= 0) return null;
  return (
    <span
      className="tabular-nums"
      style={{ background: "rgba(75,201,139,.14)", color: WIN, borderRadius: 999, padding: "2px 8px", font: "800 10px 'Archivo',sans-serif" }}
    >
      {badgeLabel(count)}
    </span>
  );
}

function Flag({ circle, size, radius, fontSize }: { circle: ShellCircle; size: number; radius: number; fontSize: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: circle.color,
        color: "#fff",
        font: `800 ${fontSize}px/${size}px 'Archivo',sans-serif`,
        textAlign: "center",
        flex: "none",
      }}
    >
      {circle.emblem ?? circle.initials}
    </div>
  );
}

function HomeSidebar({ data, context }: { data: ShellData; context: ShellContext }) {
  const active = context.kind === "home" ? context.active : "other";
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ font: "900 17px 'Archivo',sans-serif", letterSpacing: "-.01em", color: BONE, padding: "0 10px" }}>CUATRO</div>
      <div style={{ font: `400 10px ${MONO}`, color: "rgba(245,242,236,.4)", padding: "4px 10px 0" }}>everything, everywhere you play</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 20 }}>
        <NavRow href="/home" active={active === "week"} label="Your week" icon={ICONS.week} />
        <NavRow href="/discover" active={active === "discover"} label="Discover" icon={ICONS.discover} trailing={<DiscoverBadge count={data.discoverCount} />} />
        <NavRow href="/tab" active={active === "tab"} label="The Tab" icon={ICONS.tab} trailing={<TabNet line={data.tabNetLine} owing={data.tabNetOwing} />} />
        <NavRow href="/profile" active={active === "you"} label="You" icon={<YouAvatar url={data.identity.avatarUrl} active={active === "you"} />} />
      </div>

      {data.circles.length > 0 && (
        <>
          <div style={{ marginTop: 24, padding: "0 10px", font: "800 10px 'Archivo',sans-serif", letterSpacing: ".14em", color: "rgba(245,242,236,.35)" }}>
            YOUR CIRCLES
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
            {data.circles.map((c) => (
              <Link
                key={c.id}
                href={`/circles/${c.id}`}
                className={`transition-[background-color,opacity] hover:bg-[rgba(245,242,236,.05)] ${c.needsAttention ? "" : "opacity-[.55] hover:opacity-100"}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  borderRadius: 11,
                  userSelect: "none",
                }}
              >
                <Flag circle={c} size={26} radius={9} fontSize={10} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: "700 12px 'Archivo',sans-serif", color: BONE }}>{c.name}</div>
                  {c.statusLine && <div style={{ font: `400 10px ${MONO}`, color: "rgba(245,242,236,.45)" }}>{c.statusLine}</div>}
                </div>
                {(c.needsAttention || (c.unreadChatCount ?? 0) > 0) && <Dot />}
              </Link>
            ))}
          </div>
        </>
      )}
      <span style={{ flex: 1 }} />
    </div>
  );
}

/** Circle-context header subline: "6 members · est. 2024" (the founded year is dropped when unknown). */
function circleSubline(circle: ShellCircle): string {
  const n = circle.memberCount ?? 0;
  const members = `${n} member${n === 1 ? "" : "s"}`;
  return circle.foundedYear != null ? `${members} · est. ${circle.foundedYear}` : members;
}

function CircleSidebar({ data, context }: { data: ShellData; context: Extract<ShellContext, { kind: "circle" }> }) {
  const circle = data.circles.find((c) => c.id === context.circleId) ?? null;
  const base = `/circles/${context.circleId}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <Link href="/home" className="hover:underline" style={{ font: "700 11px 'Archivo',sans-serif", color: BONE_MUTED, padding: "0 10px", userSelect: "none" }}>
        ‹ Home
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 10px 0" }}>
        {circle && <Flag circle={circle} size={38} radius={12} fontSize={13} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "800 14px/1.1 'Archivo',sans-serif", color: BONE }}>{circle?.name ?? "Circle"}</div>
          {circle && <div style={{ font: `400 10px ${MONO}`, color: "rgba(245,242,236,.45)", marginTop: 2 }}>{circleSubline(circle)}</div>}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 18 }}>
        <NavRow href={base} active={context.active === "feed"} label="Feed" icon={ICONS.feed} />
        <NavRow
          href={base}
          active={context.active === "chat"}
          label="Chat"
          icon={ICONS.chat}
          trailing={<UnreadPill count={circle?.unreadChatCount ?? 0} />}
        />
        <NavRow href={base} active={context.active === "members"} label="Members" icon={ICONS.members} />
        <NavRow href={base} active={context.active === "games"} label="Games" icon={ICONS.games} />
        <NavRow href={`${base}/tab`} active={context.active === "tab"} label="The Tab" icon={ICONS.tab} trailing={<TabNet line={circle?.circleTabNetLine ?? null} owing={circle?.circleTabNetOwing ?? false} />} />
        <NavRow
          href={base}
          active={false}
          label="Settings"
          icon={ICONS.settings}
          trailing={<span style={{ font: `400 10px ${MONO}`, color: "rgba(245,242,236,.35)" }}>organiser</span>}
        />
      </div>

      <Link
        href={base}
        className="transition-colors hover:bg-[rgba(255,92,61,.08)]"
        style={{
          margin: "18px 10px 0",
          border: "1.5px dashed rgba(255,92,61,.5)",
          borderRadius: 12,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ font: "700 11.5px 'Archivo',sans-serif", color: CORAL_STRONG, flex: 1 }}>+ Invite a mate</span>
        <span style={{ font: "700 10px 'Archivo',sans-serif", color: BONE }}>Copy ↗</span>
      </Link>
      <span style={{ flex: 1 }} />
    </div>
  );
}

function YouAvatar({ url, active }: { url: string | null; active: boolean }) {
  const border = `1.5px solid ${active ? BONE : BONE_MUTED}`;
  if (url) {
    return <div style={{ width: 19, height: 19, borderRadius: "50%", border, backgroundImage: `url('${url}')`, backgroundSize: "cover", backgroundPosition: "center" }} />;
  }
  return (
    <div style={{ width: 19, height: 19, borderRadius: "50%", border, background: CORAL, color: "#fff", font: "800 9px/16px 'Archivo',sans-serif", textAlign: "center" }} />
  );
}

export function Sidebar({ data, context, className = "" }: { data: ShellData; context: ShellContext; className?: string }) {
  return (
    <aside
      className={className}
      style={{
        width: 236,
        flex: "none",
        background: SIDEBAR_BG,
        borderRight: "1px solid rgba(245,242,236,.07)",
        flexDirection: "column",
        padding: "22px 14px 18px",
      }}
    >
      {context.kind === "circle" ? <CircleSidebar data={data} context={context} /> : <HomeSidebar data={data} context={context} />}

      {/* footer identity card + brand-promise line (both contexts) */}
      <Link
        href="/profile"
        className="bg-[rgba(245,242,236,.05)] transition-colors hover:bg-[rgba(245,242,236,.09)]"
        style={{
          border: "1px solid rgba(245,242,236,.08)",
          borderRadius: 14,
          padding: "11px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {data.identity.avatarUrl ? (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              backgroundImage: `url('${data.identity.avatarUrl}')`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              flex: "none",
            }}
          />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: CORAL, color: "#fff", font: "800 12px/32px 'Archivo',sans-serif", textAlign: "center", flex: "none" }}>
            {data.identity.displayName.trim().slice(0, 1).toUpperCase() || "?"}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "700 12px 'Archivo',sans-serif", color: BONE }}>{data.identity.displayName}</div>
          <div style={{ font: `400 10px ${MONO}`, color: BONE_MUTED }}>{data.identity.factLine}</div>
        </div>
      </Link>
      <div style={{ marginTop: 10, textAlign: "center", font: `400 10px ${MONO}`, color: "rgba(245,242,236,.3)" }}>no fees · no ads · no dark patterns</div>
    </aside>
  );
}
