import { eq, and, isNotNull, asc } from "drizzle-orm";
import { users, venues } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { resolvePatch } from "@/server/patch";
import { getPlayerProfile, getPlayerLedger } from "@/server/players";
import { GlassProfile } from "@/components/glass/glass-profile";
import { ProfileAvatar } from "@/components/profile/profile-avatar";
import { SettingsSheet, type VenueOption } from "@/components/profile/settings-sheet";
import { PushToggle } from "@/components/profile/push-toggle";
import { YouWide } from "@/components/profile/you-wide";
import { Chip, Meta } from "@/components/ui";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) return null;

  const [profile, ledger] = await Promise.all([getPlayerProfile(user.id), getPlayerLedger(user.id)]);
  if (!profile) return null;

  const { db } = await getDb();

  // Discovery settings + patch status. Venue options for the home-venue picker
  // are every pinned venue the app knows (an unpinned venue can't anchor a
  // patch — see server/patch.ts), name-sorted. These stay owner-private.
  const [discoveryRow] = await db
    .select({
      findable: users.findable,
      homeVenueId: users.homeVenueId,
      patchSize: users.patchSize,
      dominantHand: users.dominantHand,
      courtSide: users.courtSide,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const venueOptions: VenueOption[] = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(isNotNull(venues.lat), isNotNull(venues.lng)))
    .orderBy(asc(venues.name));
  const patch = await resolvePatch(db, user.id);
  const homeVenueName = discoveryRow?.homeVenueId
    ? (venueOptions.find((v) => v.id === discoveryRow.homeVenueId)?.name ?? null)
    : null;
  const patchStatusLine = !discoveryRow?.findable
    ? "Not findable, nearby games can't see you."
    : patch
      ? patch.source === "home_venue" && homeVenueName
        ? `On The Board · home venue ${homeVenueName}`
        : patch.source === "inferred"
          ? "On The Board · placed by where you play"
          : "On The Board · placed by your chosen area"
      : "Set a home venue to appear on The Board.";

  const circlesCount = profile.circlesCount;

  return (
    <>
      {/* Phone: unchanged. */}
      <main className="px-4 pt-6 pb-6 flex flex-col gap-4 min-[900px]:hidden">
        <GlassProfile
          profile={profile}
          avatar={<ProfileAvatar name={user.displayName ?? user.email} avatarUrl={user.avatarUrl} />}
          ledgerHref="/profile/ledger"
          ledgerBlurb="every movement of your Glass, explained"
          circlesChip={
            <Chip>
              {circlesCount} {circlesCount === 1 ? "Circle" : "Circles"}
            </Chip>
          }
          enableReveal
        />

        <Meta as="p" className="text-center">
          {patchStatusLine}
        </Meta>

        <PushToggle />

        <SettingsSheet
          displayName={user.displayName}
          email={user.email}
          findable={discoveryRow?.findable ?? true}
          homeVenueId={discoveryRow?.homeVenueId ?? null}
          venueOptions={venueOptions}
          patchSize={discoveryRow?.patchSize ?? "local"}
          dominantHand={discoveryRow?.dominantHand ?? null}
          courtSide={discoveryRow?.courtSide ?? null}
        />
      </main>

      {/* Wide (>= 900px): the home-context "You" surface. */}
      <div className="c4-wide hidden min-[900px]:block w-full max-w-[1000px] mx-auto px-[30px]">
        <YouWide
          profile={profile}
          ledgerRows={ledger?.rows ?? []}
          displayName={user.displayName ?? user.email}
          avatarUrl={user.avatarUrl}
          patch={patch ? { lat: patch.lat, lng: patch.lng, radiusKm: patch.radiusKm } : null}
          patchSize={discoveryRow?.patchSize ?? "local"}
          homeVenueId={discoveryRow?.homeVenueId ?? null}
          homeVenueName={homeVenueName}
          findable={discoveryRow?.findable ?? true}
          venueOptions={venueOptions}
        />
      </div>
    </>
  );
}
