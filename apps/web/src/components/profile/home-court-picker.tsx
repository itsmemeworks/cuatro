"use client";

import { InfoTerm, Meta } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";

/**
 * The home-court control for profile settings, choose-OR-ADD: the same
 * contract as the standing-game venue picker (games/standing/venue-picker.tsx)
 * — pick a known court, or reveal free-form name + postcode fields that the
 * server dedupe-matches or creates-and-geocodes (discovery-actions.ts). Only
 * one of {homeVenueId} or {newCourtName, newCourtAddress} is ever submitted.
 *
 * Unlike the standing picker this one is fully CONTROLLED: it lives inside
 * surfaces that stay mounted across a failed save (the settings Sheet, the
 * wide Settings page), where React 19's form-reset-on-resolve would wipe an
 * uncontrolled field's typed postcode the moment the action returned an error
 * (CLAUDE.md #14). The parent owns the state; this renders it.
 */

/** Select sentinel for "Add a new court" — never submitted as a homeVenueId ("" already means "no home court"). */
export const ADD_NEW_COURT = "__add_new__";

/**
 * Context-specific copy for the add-a-new-court save results (convention #9:
 * raw codes never reach the UI; page-local map for page-local codes, falling
 * back to the shared errorCopy for everything else).
 */
const HOME_COURT_ERROR_COPY: Record<string, string> = {
  court_name_missing: "Give the court a name so we can put it on the map.",
  postcode_unresolved: "That postcode didn't land anywhere we know. Check it and try again.",
};

export function homeCourtErrorCopy(code: string): string {
  return HOME_COURT_ERROR_COPY[code] ?? errorCopy(code);
}

export interface HomeCourtOption {
  id: string;
  name: string;
}

export function HomeCourtPicker({
  venues,
  adding,
  onAddingChange,
  venueId,
  onVenueIdChange,
  courtName,
  onCourtNameChange,
  courtAddress,
  onCourtAddressChange,
  error,
  disabled,
  fieldClassName,
  selectId,
}: {
  venues: HomeCourtOption[];
  /** True when the free-form add-a-new-court fields are revealed. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  /** The persisted/selected known-venue id ("" = no home court). Kept separate from `adding` so leaving add mode restores the real selection. */
  venueId: string;
  onVenueIdChange: (id: string) => void;
  courtName: string;
  onCourtNameChange: (name: string) => void;
  courtAddress: string;
  onCourtAddressChange: (address: string) => void;
  /** Already-humanised error line (homeCourtErrorCopy), or null. */
  error?: string | null;
  disabled?: boolean;
  /** Field styling per surface (the sheet and the wide page use different input scales). */
  fieldClassName: string;
  selectId?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <select
        id={selectId}
        // In add mode the sentinel must not submit as a homeVenueId; the
        // free-form inputs below carry the submission instead.
        name={adding ? undefined : "homeVenueId"}
        value={adding ? ADD_NEW_COURT : venueId}
        onChange={(e) => {
          const next = e.target.value;
          if (next === ADD_NEW_COURT) {
            onAddingChange(true);
          } else {
            onAddingChange(false);
            onVenueIdChange(next);
          }
        }}
        disabled={disabled}
        aria-label="Home court"
        className={fieldClassName}
      >
        <option value="">No home court</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
        <option value={ADD_NEW_COURT}>Add a new court</option>
      </select>

      {adding && (
        <>
          <label className="flex flex-col gap-1.5 text-cu-secondary font-semibold text-ink-muted">
            New court name
            <input
              type="text"
              name="newCourtName"
              value={courtName}
              onChange={(e) => onCourtNameChange(e.target.value)}
              placeholder="e.g. Powerleague Shoreditch"
              disabled={disabled}
              className={fieldClassName}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-cu-secondary font-semibold text-ink-muted">
            Postcode or address
            <input
              type="text"
              name="newCourtAddress"
              value={courtAddress}
              onChange={(e) => onCourtAddressChange(e.target.value)}
              placeholder="e.g. Braithwaite St, London E1 6GJ"
              disabled={disabled}
              className={fieldClassName}
            />
          </label>
          <Meta as="p">
            A UK postcode is enough, it pins the court on the map. If it&apos;s a court we already know, we&apos;ll
            match it, no duplicates.
          </Meta>
        </>
      )}

      {error && (
        <Meta as="p" tone="loss">
          {error}
        </Meta>
      )}

      <Meta as="p">
        Your home court sets <InfoTerm term="patch" label="your patch" />, everything near you is measured from it,
        court to court. Never GPS.
      </Meta>
    </div>
  );
}
