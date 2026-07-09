"use client";

import { useState } from "react";
import { Meta } from "@/components/ui";
import type { VenueOption } from "@/server/venues";

const fieldClass =
  "rounded-button p-3 text-[14px] bg-surface border border-ink-hairline-3 text-ink outline-none";

// Empty string is the "Add a new court" sentinel: an empty venueId submits as
// no id, so the server falls through to the free-form name/address it reveals.
const ADD_NEW = "";

/**
 * Venue picker for the Standing Game forms: a dropdown of known venues
 * (home court first, then ones this circle has played at, then the rest),
 * plus an "Add a new court" option that reveals the free-form name + address
 * fields. Only one of {venueId} or {venueName, venueAddress} is ever
 * submitted, so the server action either picks the chosen venue or dedupe-
 * matches the free-form text before creating anything.
 */
export function VenuePicker({
  venues,
  defaultVenueId,
  defaultName = "",
  defaultAddress = "",
}: {
  venues: VenueOption[];
  defaultVenueId?: string | null;
  defaultName?: string;
  defaultAddress?: string;
}) {
  const hasKnownDefault = defaultVenueId != null && venues.some((v) => v.id === defaultVenueId);
  // Open on the current venue when there is one, otherwise on the first known
  // venue when the dropdown has any, otherwise straight into "add a new court".
  const [selection, setSelection] = useState<string>(
    hasKnownDefault ? (defaultVenueId as string) : venues.length > 0 ? venues[0].id : ADD_NEW,
  );

  const addingNew = selection === ADD_NEW;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
        Court
        <select
          name="venueId"
          value={selection}
          onChange={(e) => setSelection(e.target.value)}
          className={fieldClass}
        >
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.areaHint ? `${v.name} · ${v.areaHint}` : v.name}
            </option>
          ))}
          <option value={ADD_NEW}>Add a new court</option>
        </select>
      </label>

      {addingNew && (
        <>
          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            New court name
            <Meta as="span" className="font-normal">
              we&apos;ll match it to a known court if it is one already
            </Meta>
            <input
              type="text"
              name="venueName"
              defaultValue={defaultName}
              placeholder="e.g. Powerleague Shoreditch"
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1.5 text-cu-body font-semibold text-ink">
            Address
            <input
              type="text"
              name="venueAddress"
              defaultValue={defaultAddress}
              placeholder="e.g. Braithwaite St, London E1 6GJ"
              className={fieldClass}
            />
          </label>
        </>
      )}
    </div>
  );
}
