import { eq, and, isNotNull, asc } from "drizzle-orm";
import { users, venues } from "@cuatro/db";
import { getSessionUser } from "@/lib/session";
import { getDb } from "@/server/db";
import { SettingsWide } from "@/components/profile/settings-wide";
import type { VenueOption } from "@/components/profile/settings-sheet";

/**
 * The home-context Settings surface (design/CUATRO-Web-LATEST.dc.html "Home ·
 * Settings"), reached from the wide "You" screen's Settings chip. The phone
 * keeps its existing Settings sheet on /profile (unchanged); this is a new
 * route, so it has no phone baseline to preserve — SettingsWide stacks to one
 * column below 900px and opens to two columns at wide widths. The discovery
 * read mirrors /profile (findable + home venue + the pinned-venue picker
 * options); everything writes through the same existing server actions.
 */
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const { db } = await getDb();
  const [discoveryRow] = await db
    .select({
      findable: users.findable,
      homeVenueId: users.homeVenueId,
      dominantHand: users.dominantHand,
      courtSide: users.courtSide,
      notifyFourthCall: users.notifyFourthCall,
      notifyRotation: users.notifyRotation,
      notifyTabNudge: users.notifyTabNudge,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);
  const venueOptions: VenueOption[] = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(isNotNull(venues.lat), isNotNull(venues.lng)))
    .orderBy(asc(venues.name));
  const homeVenueName = discoveryRow?.homeVenueId
    ? (venueOptions.find((v) => v.id === discoveryRow.homeVenueId)?.name ?? null)
    : null;

  return (
    <div className="c4-wide w-full max-w-[1000px] mx-auto px-4 min-[900px]:px-[30px] pt-6 min-[900px]:pt-0 pb-6">
      <SettingsWide
        displayName={user.displayName}
        email={user.email}
        avatarUrl={user.avatarUrl}
        findable={discoveryRow?.findable ?? true}
        homeVenueId={discoveryRow?.homeVenueId ?? null}
        homeVenueName={homeVenueName}
        venueOptions={venueOptions}
        dominantHand={discoveryRow?.dominantHand ?? null}
        courtSide={discoveryRow?.courtSide ?? null}
        notifyFourthCall={discoveryRow?.notifyFourthCall ?? true}
        notifyRotation={discoveryRow?.notifyRotation ?? true}
        notifyTabNudge={discoveryRow?.notifyTabNudge ?? true}
      />
    </div>
  );
}
