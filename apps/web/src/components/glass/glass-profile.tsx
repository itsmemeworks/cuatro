import Link from "next/link";
import { GlassHero } from "@/components/glass/glass-hero";
import { ReliabilityBadge } from "@/components/glass/reliability-badge";
import { Card, Chip, Meta } from "@/components/ui";
import type { PlayerProfile } from "@/server/players";

/**
 * The shared Glass transparency body: header badges, the Glass hero,
 * the W–L / streak / best-win stat row, the Ledger link, and "Last three".
 * Rendered identically by the viewer's OWN profile (`/profile`) and by any
 * player's public profile (`/players/[userId]`) — the transparency thesis
 * applied to everyone, not just yourself. The avatar is passed as a slot so
 * the owner gets the camera-badge affordance and a public view gets a plain
 * one; `enableReveal` is false on public views (the Rating Reveal is the
 * owner's private first-look).
 */
export function GlassProfile({
  profile,
  avatar,
  ledgerHref,
  ledgerBlurb,
  circlesChip,
  enableReveal = true,
}: {
  profile: PlayerProfile;
  avatar: React.ReactNode;
  ledgerHref: string;
  /** The Ledger card's one-line subtitle — "every movement of your Glass, explained" (own) vs "…of Alex's Glass…" (public). */
  ledgerBlurb: string;
  /** The chip beside the reliability badge — own profile: total Circles; public: circles in common (or nothing when none). */
  circlesChip: React.ReactNode;
  enableReveal?: boolean;
}) {
  const { user, glass, history, sparklineValues, deltaSinceFirst, streak, bestWin, lastThree } = profile;

  return (
    <>
      <div className="flex items-center gap-3">
        {avatar}
        <div className="flex-1">
          <h1 className="text-cu-title text-ink">{user.displayName}</h1>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {glass && <ReliabilityBadge pct={glass.reliabilityPct} lateCancelCount={glass.lateCancelCount} />}
            {circlesChip}
          </div>
        </div>
      </div>

      {glass && (
        <GlassHero
          glass={glass}
          userId={user.id}
          sparklineValues={sparklineValues}
          deltaSinceFirst={deltaSinceFirst}
          enableReveal={enableReveal}
        />
      )}

      {glass && glass.status === "rated" && (
        <div className="flex gap-2">
          <Card className="flex-1 text-center">
            <p className="text-cu-card-title text-ink">
              {history.wins}–{history.losses}
            </p>
            <Meta className="mt-0.5 block">W–L</Meta>
          </Card>
          <Card className="flex-1 text-center">
            <p className="text-cu-card-title text-ink">{streak.kind ? `${streak.kind}${streak.count}` : "—"}</p>
            <Meta className="mt-0.5 block">streak</Meta>
          </Card>
          <Card className="flex-1 text-center">
            <p className="text-cu-card-title text-ink">{bestWin != null ? `vs ${bestWin.toFixed(2)}` : "—"}</p>
            <Meta className="mt-0.5 block">best win</Meta>
          </Card>
        </div>
      )}

      <Link href={ledgerHref}>
        <Card className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-cu-card-title text-ink">The Ledger</p>
            <p className="text-cu-secondary text-ink-muted mt-0.5">{ledgerBlurb}</p>
          </div>
          <span className="text-cu-card-title font-bold text-action">→</span>
        </Card>
      </Link>

      {lastThree.some(Boolean) && (
        <div>
          <p className="text-cu-secondary font-extrabold text-ink-muted px-0.5">Last three</p>
          <div className="flex gap-2 mt-2">
            {lastThree.map(
              (r) =>
                r && (
                  <Chip key={r.id} tone={r.won ? "positive" : "negative"} className="flex-1 justify-center py-2.5 text-[12px]">
                    {r.label}
                  </Chip>
                ),
            )}
          </div>
        </div>
      )}
    </>
  );
}
