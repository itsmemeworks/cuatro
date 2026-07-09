"use client";

import { useState } from "react";
import { Button, Card, InfoTerm, Meta, Sheet } from "@/components/ui";
import { updateDisplayNameAction } from "@/lib/actions";
import { updateDiscoverySettingsAction } from "@/app/(app)/profile/discovery-actions";

export interface VenueOption {
  id: string;
  name: string;
}

/**
 * Display-name edit + discovery settings + logout, behind a quiet "Settings"
 * row + sheet (design/DESIGN-AUDIT.md P4). The discovery block powers The
 * Board / Local Ring / Open Door: a `findable` consent toggle and a home-venue
 * picker — the anchor whose pin places the player on the map (server/patch.ts).
 * No coral here: Save is `strong`.
 */
export function SettingsSheet({
  displayName,
  email,
  findable,
  homeVenueId,
  venueOptions,
}: {
  displayName: string | null;
  email: string;
  findable: boolean;
  homeVenueId: string | null;
  venueOptions: VenueOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-cu-secondary font-semibold text-ink-muted text-center py-2"
      >
        Settings
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Settings">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <form action={updateDisplayNameAction} className="flex flex-col gap-3">
              <label htmlFor="displayName" className="text-cu-secondary font-semibold text-ink-muted">
                Display name
              </label>
              <input
                id="displayName"
                name="displayName"
                defaultValue={displayName ?? ""}
                placeholder="What should your Circles call you?"
                className="w-full rounded-button px-4 py-3 text-cu-body outline-none bg-ground border border-ink-hairline-2 text-ink"
                style={{ minHeight: "var(--touch-target)" }}
              />
              <Button type="submit" variant="strong" size="lg" fullWidth>
                Save
              </Button>
            </form>
            <Meta>{email}</Meta>
          </Card>

          <Card className="flex flex-col gap-3">
            <form action={updateDiscoverySettingsAction} className="flex flex-col gap-3">
              <p className="text-cu-secondary font-semibold text-ink-muted">
                Games <InfoTerm term="board" label="near you" />
              </p>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  name="findable"
                  defaultChecked={findable}
                  className="size-5 accent-[var(--color-action)]"
                />
                <span className="text-cu-body text-ink flex-1">Let nearby games find me</span>
              </label>
              <Meta as="p">
                Only Circles you don&apos;t belong to see you, and only as a rough distance — never your exact location.
              </Meta>

              <label htmlFor="homeVenueId" className="text-cu-secondary font-semibold text-ink-muted mt-1">
                Home venue
              </label>
              <select
                id="homeVenueId"
                name="homeVenueId"
                defaultValue={homeVenueId ?? ""}
                className="w-full rounded-button px-4 py-3 text-cu-body outline-none bg-ground border border-ink-hairline-2 text-ink"
                style={{ minHeight: "var(--touch-target)" }}
              >
                <option value="">No home venue</option>
                {venueOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <Meta as="p">This is what places you on The Board — pick where you usually play.</Meta>

              <Button type="submit" variant="strong" size="lg" fullWidth>
                Save
              </Button>
            </form>
          </Card>

          <form action="/api/auth/logout" method="POST">
            <Button type="submit" variant="quiet" size="lg" fullWidth>
              Log out
            </Button>
          </form>
        </div>
      </Sheet>
    </>
  );
}
