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

  return (
    <main className="px-5 pt-8 pb-6 flex flex-col gap-6">
      <div>
        <h1 className="text-cu-title text-ink">Make it yours</h1>
        <p className="text-cu-secondary text-ink-muted mt-1">every Circle gets a header, a colour and a mark</p>
      </div>
      <CreateCircleForm venueOptions={venueOptions} />
    </main>
  );
}
