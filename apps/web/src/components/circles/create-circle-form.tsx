"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Meta } from "@/components/ui";
import { HEADER_KEYS, type HeaderKey } from "@/lib/circle-headers";
import { errorCopy } from "@/lib/error-copy";
import { EMBLEM_PRESETS, COLOUR_PRESETS, TIMEZONE_PRESETS } from "./presets";
import { EmblemPicker, isEmblemTooLong } from "./emblem-picker";
import { HeaderPicker, CircleCardArt } from "./circle-header";

// Mirrors MAX_CIRCLE_NAME_LENGTH in server/circles.ts — kept local so this
// client component never pulls the better-sqlite3-backed server module into
// the browser bundle (same reason door-controls.tsx inlines its own limit).
const MAX_CIRCLE_NAME_LENGTH = 40;
const MIN_MAX_MEMBERS = 4;
const MAX_MAX_MEMBERS = 64;

const fieldClass =
  "w-full rounded-button px-4 py-3 text-[14px] outline-none bg-surface border border-ink-hairline-3 text-ink placeholder:text-ink-muted";

const CREATE_ERROR_COPY: Record<string, string> = {
  invalid_name: "Give your Circle a name, up to 40 characters.",
  invalid_emblem: "One emoji is plenty.",
  invalid_colour: "Pick one of the colours.",
  invalid_header_image: errorCopy("invalid_header_image"),
  invalid_home_venue: errorCopy("invalid_home_venue"),
  invalid_max_members: errorCopy("invalid_max_members"),
  something_went_wrong: "Something went wrong, try again.",
};

export interface CreateVenueOption {
  id: string;
  name: string;
}

/**
 * "Make it yours" (Directions turn 10a) — a header image, name, colour + mark,
 * home court and an optional roster cap, with a live card-art preview. A fresh
 * header is auto-picked on mount so a Circle looks good with zero setup;
 * Shuffle or the grid change it. This is the creation flow, so the preview
 * stands in for the "Tue 8pm · 3 of 4 in" pinned chip a live Circle shows.
 */
export function CreateCircleForm({ venueOptions = [] }: { venueOptions?: CreateVenueOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [emblem, setEmblem] = useState<string>(EMBLEM_PRESETS[0]);
  const [colour, setColour] = useState<string>(COLOUR_PRESETS[0]);
  const [header, setHeader] = useState<HeaderKey>(HEADER_KEYS[0]);
  const [homeVenueId, setHomeVenueId] = useState<string>("");
  const [maxMembers, setMaxMembers] = useState<string>("");
  const [timezone, setTimezone] = useState<string>("Europe/London");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorCode, setErrorCode] = useState<string>("something_went_wrong");

  // Pick a random header after mount (not during render — a Math.random default
  // would mismatch server/client hydration). Every new Circle then opens with a
  // photo that isn't always court-01, while staying an explicit, valid key.
  useEffect(() => {
    setHeader(HEADER_KEYS[Math.floor(Math.random() * HEADER_KEYS.length)]);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || status === "saving") return;
    if (isEmblemTooLong(emblem)) {
      setErrorCode("invalid_emblem");
      setStatus("error");
      return;
    }
    let parsedMax: number | null = null;
    if (maxMembers.trim() !== "") {
      const n = Number(maxMembers);
      if (!Number.isInteger(n) || n < MIN_MAX_MEMBERS || n > MAX_MAX_MEMBERS) {
        setErrorCode("invalid_max_members");
        setStatus("error");
        return;
      }
      parsedMax = n;
    }
    setStatus("saving");
    try {
      const res = await fetch("/api/circles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          emblem,
          colour,
          timezone,
          headerImage: header,
          homeVenueId: homeVenueId === "" ? null : homeVenueId,
          maxMembers: parsedMax,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorCode(typeof body?.error === "string" ? body.error : "something_went_wrong");
        setStatus("error");
        return;
      }
      const { circle } = (await res.json()) as { circle: { id: string } };
      router.push(`/circles/${circle.id}`);
    } catch {
      setErrorCode("something_went_wrong");
      setStatus("error");
    }
  }

  const initials = name.trim().slice(0, 2).toUpperCase() || "TN";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* Live preview — the card art a Circle shows in lists, repainting live. */}
      <div className="rounded-card overflow-hidden border border-ink-hairline-2">
        <CircleCardArt
          circleId="new"
          headerImage={header}
          colour={colour}
          emblem={emblem || initials}
          name={name.trim() || "Your Circle"}
        />
      </div>

      <HeaderPicker selected={header} onChange={setHeader} />

      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-cu-body font-semibold text-ink">
          Circle name
        </label>
        <input
          id="name"
          required
          maxLength={MAX_CIRCLE_NAME_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tuesday Night Lot"
          className={fieldClass}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-cu-meta uppercase tracking-[0.14em] text-ink-muted">Colour</span>
        <div className="flex flex-wrap gap-2.5">
          {COLOUR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColour(c)}
              aria-pressed={colour === c}
              aria-label={c}
              className="w-9 h-9 rounded-full transition-cu-state"
              style={{
                background: c,
                boxShadow: colour === c ? "0 0 0 3px var(--color-surface), 0 0 0 5px currentColor" : "none",
                color: c,
              }}
            />
          ))}
        </div>
      </div>

      <EmblemPicker emblem={emblem} onChange={setEmblem} />

      {venueOptions.length > 0 && (
        <div className="flex flex-col gap-2">
          <label htmlFor="home-venue" className="text-cu-body font-semibold text-ink">
            Home court (optional)
          </label>
          <select id="home-venue" value={homeVenueId} onChange={(e) => setHomeVenueId(e.target.value)} className={fieldClass}>
            <option value="">Automatic (where you play)</option>
            {venueOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <Meta as="p">Leave it automatic and it pins itself once you play somewhere with an address.</Meta>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="max-members" className="text-cu-body font-semibold text-ink">
          Max players (optional)
        </label>
        <input
          id="max-members"
          type="number"
          inputMode="numeric"
          min={MIN_MAX_MEMBERS}
          max={MAX_MAX_MEMBERS}
          value={maxMembers}
          onChange={(e) => setMaxMembers(e.target.value)}
          placeholder="No limit"
          className={fieldClass}
        />
        <Meta as="p">Most circles run 4 to 12. Leave it blank to keep joining open.</Meta>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="timezone" className="text-cu-body font-semibold text-ink">
          Timezone
        </label>
        <select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={fieldClass}>
          {TIMEZONE_PRESETS.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </div>

      <Button type="submit" size="lg" fullWidth disabled={status === "saving" || !name.trim()}>
        {status === "saving" ? "Creating…" : "Create Circle"}
      </Button>
      {status === "error" && <Meta tone="action">{CREATE_ERROR_COPY[errorCode] ?? CREATE_ERROR_COPY.something_went_wrong}</Meta>}
      <Meta as="p" className="text-center">
        coral stays the app&apos;s action colour, your colour identifies, it never asks
      </Meta>
    </form>
  );
}
