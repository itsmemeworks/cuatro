import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getPlayerProfile } from "@/server/players";
import { GlassProfile } from "@/components/glass/glass-profile";
import { BackLink } from "@/components/glass/back-link";
import { Avatar, Card, Chip, Meta } from "@/components/ui";

/**
 * A public player profile: tap anyone (from a members list, a nearby-Circle
 * preview, or a result) and get the same transparency surface you get on your
 * own profile — Glass, confidence, Reliability, stats, and the full Ledger.
 * Signed-in only (it lives in the (app) group). Viewing your own id redirects
 * to /profile so there's a single canonical own-profile surface. Guests get a
 * minimal presence page (no rating, no Ledger). Private everywhere: email,
 * settings, The Tab, invite links.
 */
export default async function PlayerProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const viewer = await getSessionUser();
  if (!viewer) return null; // (app) layout already redirects unauthenticated; this is a type guard.

  const { userId } = await params;
  if (userId === viewer.id) redirect("/profile");

  const profile = await getPlayerProfile(userId, viewer.id);
  if (!profile) notFound();

  const { user, circlesInCommon } = profile;
  const firstName = user.displayName.split(" ")[0] || user.displayName;

  // Guests are first-class users but carry no rating or Ledger — a minimal
  // presence page, never a broken rating/Ledger surface.
  if (user.isGuest) {
    return (
      <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
        <BackLink />
        <div className="flex items-center gap-3">
          <Avatar src={user.avatarUrl} name={user.displayName} size="lg" />
          <div className="flex-1">
            <h1 className="text-cu-title text-ink">{user.displayName}</h1>
            <div className="mt-1.5">
              <Chip tone="neutral">Plays as a guest</Chip>
            </div>
          </div>
        </div>
        <Card>
          <Meta as="p">
            {firstName} joined a game without an account yet. Once they claim their spot, their Glass and Ledger show up here.
          </Meta>
        </Card>
      </main>
    );
  }

  const circlesChip =
    circlesInCommon && circlesInCommon > 0 ? (
      <Chip>
        {circlesInCommon} in common
      </Chip>
    ) : null;

  return (
    <main className="px-4 pt-6 pb-6 flex flex-col gap-4">
      <BackLink />
      <GlassProfile
        profile={profile}
        avatar={<Avatar src={user.avatarUrl} name={user.displayName} size="lg" />}
        ledgerHref={`/players/${user.id}/ledger`}
        ledgerBlurb={`every movement of ${firstName}'s Glass, explained`}
        circlesChip={circlesChip}
        enableReveal={false}
      />
    </main>
  );
}
