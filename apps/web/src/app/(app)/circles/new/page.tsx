import { and, asc, isNotNull } from "drizzle-orm";
import { venues } from "@cuatro/db";
import { getDb } from "@/server/db";
import { CreateCircleForm, type CreateVenueOption } from "@/components/circles/create-circle-form";

export default async function NewCirclePage() {
  // Pinned venues only (lat/lng resolved) — the same set the profile home-venue
  // picker offers, so an organiser's home-court choice can anchor discovery.
  const { db } = await getDb();
  const venueOptions: CreateVenueOption[] = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(and(isNotNull(venues.lat), isNotNull(venues.lng)))
    .orderBy(asc(venues.name));

  // Below 900px this is the shipped phone page, unchanged. At 900px+ the
  // c4-wide hook lifts the shell's 448 clamp and the form renders the design's
  // centred 560px "START A CIRCLE" card (the phone heading hides — the card
  // carries its own header bar).
  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6 c4-wide min-[900px]:px-[30px] min-[900px]:pt-0 min-[900px]:pb-0 min-[900px]:max-w-[620px] min-[900px]:mx-auto min-[900px]:w-full">
      <div className="min-[900px]:hidden">
        <h1 className="text-cu-title text-ink">Make it yours</h1>
        <p className="text-cu-secondary text-ink-muted mt-1">every Circle gets a header, a colour and a mark</p>
      </div>
      <CreateCircleForm venueOptions={venueOptions} />
    </main>
  );
}
