"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Meta } from "@/components/ui";
import { HEADER_KEYS, type HeaderKey } from "@/lib/circle-headers";
import { errorCopy } from "@/lib/error-copy";
import { saveDoorSettings } from "@/app/(app)/circles/[id]/door-actions";
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

/** The design's visibility tiers (WHO CAN FIND IT) — wide create only; the two flags they expand to match door-controls.tsx's tierFor. */
type Tier = "open" | "invite_only" | "private";
const TIERS: { id: Tier; name: string; line: string }[] = [
  { id: "open", name: "Open", line: " · anyone nearby can ask, you approve" },
  { id: "invite_only", name: "Invite only", line: " · link or QR only" },
  { id: "private", name: "Private", line: " · unlisted everywhere" },
];
const FLAGS_FOR_TIER: Record<Tier, { openDoor: boolean; boardEnabled: boolean }> = {
  open: { openDoor: true, boardEnabled: true },
  invite_only: { openDoor: false, boardEnabled: true },
  private: { openDoor: false, boardEnabled: false },
};

/**
 * "Make it yours" (Directions turn 10a) — a header image, name, colour + mark,
 * home court and an optional roster cap, with a live card-art preview. A fresh
 * header is auto-picked on mount so a Circle looks good with zero setup;
 * Shuffle or the grid change it. This is the creation flow, so the preview
 * stands in for the "Tue 8pm · 3 of 4 in" pinned chip a live Circle shows.
 *
 * ONE responsive tree, ONE state (WEB-SHELL-SPEC.md Wave C): below 900px the
 * shipped phone form, byte-for-byte; at 900px+ the design's "START A CIRCLE"
 * card (name, flag, WHO CAN FIND IT tiers, then the success step with the
 * invite link). Both trees are controlled by the same state, so only the
 * markup differs by width, never the data.
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
  // Wide-only extras: the visibility tier (the shipped default is Open — the
  // 2026-07-09 "findable on by default" decision) and the success step.
  const [tier, setTier] = useState<Tier>("open");
  const [moreOpen, setMoreOpen] = useState(false);
  const [created, setCreated] = useState<{ id: string; inviteCode: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorCode, setErrorCode] = useState<string>("something_went_wrong");

  // Pick a random header after mount (not during render — a Math.random default
  // would mismatch server/client hydration). Every new Circle then opens with a
  // photo that isn't always court-01, while staying an explicit, valid key.
  useEffect(() => {
    setHeader(HEADER_KEYS[Math.floor(Math.random() * HEADER_KEYS.length)]);
    setOrigin(window.location.origin);
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
      const { circle } = (await res.json()) as { circle: { id: string; inviteCode: string } };
      // The tier picker only renders at wide widths; a non-default choice is
      // applied right after create through the same action the settings tab
      // uses (the creator is the organiser). Best-effort: a failure leaves the
      // Circle Open, which the settings screen can fix in one tap.
      if (tier !== "open") {
        try {
          await saveDoorSettings(circle.id, FLAGS_FOR_TIER[tier]);
        } catch {
          // best-effort — the Circle stays Open; Settings fixes it in one tap
        }
      }
      if (window.matchMedia("(min-width: 900px)").matches) {
        // Wide: the design's success step (invite link + Copy), then Done.
        setCreated({ id: circle.id, inviteCode: circle.inviteCode });
        setStatus("idle");
      } else {
        router.push(`/circles/${circle.id}`);
      }
    } catch {
      setErrorCode("something_went_wrong");
      setStatus("error");
    }
  }

  const initials = name.trim().slice(0, 2).toUpperCase() || "TN";
  const trimmedName = name.trim();
  const inviteReadable = created ? `${origin.replace(/^https?:\/\//, "")}/join/${created.inviteCode}` : "";

  async function copyInvite() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(`${origin}/join/${created.inviteCode}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard denied — the readable link stays selectable
    }
  }

  // ===== wide success step (design "Create a Circle" step 2) =====
  if (created) {
    return (
      <div className="bg-surface border border-ink-hairline-3 rounded-[22px] overflow-hidden min-[900px]:mt-[38px]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ink-hairline-1">
          <span className="font-sans font-extrabold text-[11px] tracking-[0.14em] text-ink-muted flex-1">START A CIRCLE</span>
        </div>
        <div className="px-5 py-[22px] text-center">
          <div
            className="w-16 h-16 rounded-[18px] mx-auto flex items-center justify-center font-sans font-extrabold text-[19px] text-white"
            style={{ background: colour }}
          >
            {emblem.trim() || initials}
          </div>
          <p className="font-sans font-extrabold text-[21px] text-ink mt-3.5">{trimmedName || "Your Circle"} exists</p>
          <Meta as="p" className="mt-1.5">
            send this to the group chat. They&apos;re in before their first game
          </Meta>
          <div className="flex items-center gap-2 max-w-[380px] mx-auto mt-4">
            <span className="flex-1 min-w-0 truncate bg-ground border border-ink-hairline-3 rounded-full px-4 py-[11px] font-mono text-[11.5px] text-ink/75 text-left">
              🔒 {inviteReadable}
            </span>
            <button
              type="button"
              onClick={copyInvite}
              className="bg-strong-bg text-strong-fg rounded-full px-[17px] py-[11px] font-sans font-bold text-[11.5px] flex-none transition-cu-state hover:opacity-90 active:opacity-80"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/circles/${created.id}`)}
            className="inline-block border border-ink-hairline-4 text-ink rounded-[13px] px-7 py-3 font-sans font-bold text-[13px] mt-[18px] transition-cu-state hover:bg-ink-hairline-1 active:opacity-80"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* ===== phone tree (<900px) — the shipped form, unchanged ===== */}
      <div className="min-[900px]:hidden flex flex-col gap-6">
        {/* Live preview — the card art a Circle shows in lists, repainting live. */}
        <div className="rounded-card overflow-hidden border border-ink-hairline-2">
          <CircleCardArt
            circleId="new"
            headerImage={header}
            colour={colour}
            emblem={emblem || initials}
            name={trimmedName || "Your Circle"}
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

        <Button type="submit" size="lg" fullWidth pending={status === "saving"} disabled={!name.trim()}>
          {status === "saving" ? "Creating…" : "Create Circle"}
        </Button>
        {status === "error" && <Meta tone="action">{CREATE_ERROR_COPY[errorCode] ?? CREATE_ERROR_COPY.something_went_wrong}</Meta>}
        <Meta as="p" className="text-center">
          coral stays the app&apos;s action colour, your colour identifies, it never asks
        </Meta>
      </div>

      {/* ===== wide tree (900px+) — the design's START A CIRCLE card ===== */}
      <div className="hidden min-[900px]:block bg-surface border border-ink-hairline-3 rounded-[22px] overflow-hidden mt-[38px]">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ink-hairline-1">
          <span className="font-sans font-extrabold text-[11px] tracking-[0.14em] text-ink-muted flex-1">START A CIRCLE</span>
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Close"
            className="font-sans font-bold text-[13px] text-ink-muted transition-cu-state hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="px-5 pt-[18px] pb-5">
          <label htmlFor="wide-name" className="block font-mono text-[10px] text-ink-muted">
            NAME
          </label>
          <input
            id="wide-name"
            maxLength={MAX_CIRCLE_NAME_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sunday Scramblers"
            className="mt-1.5 w-full bg-ground border border-ink-hairline-3 rounded-[13px] px-4 py-[13px] font-sans font-semibold text-[14px] text-ink outline-none placeholder:text-ink-muted"
          />

          <div className="flex items-center gap-3.5 mt-4">
            <div
              className="w-14 h-14 rounded-[16px] flex items-center justify-center font-sans font-extrabold text-[17px] text-white flex-none"
              style={{ background: colour }}
            >
              {emblem.trim() || initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] text-ink-muted">FLAG · {initials} is auto-cut from the name</div>
              <div className="flex gap-2 mt-2">
                {COLOUR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColour(c)}
                    aria-pressed={colour === c}
                    aria-label={c}
                    className="w-[26px] h-[26px] rounded-full transition-cu-state box-border"
                    style={{ background: c, border: colour === c ? "2.5px solid var(--color-ink)" : "none" }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="font-mono text-[10px] text-ink-muted mt-[18px]">WHO CAN FIND IT</div>
          <div className="mt-2 bg-ground border border-ink-hairline-2 rounded-[14px] overflow-hidden">
            {TIERS.map((t, i) => {
              const active = tier === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTier(t.id)}
                  aria-pressed={active}
                  className={`w-full flex items-center gap-[11px] px-3.5 py-[11px] text-left transition-cu-state hover:bg-ink-hairline-1 ${
                    i < TIERS.length - 1 ? "border-b border-ink-hairline-1" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className="w-[15px] h-[15px] rounded-full box-border flex-none"
                    style={active ? { border: "5px solid var(--color-action)" } : { border: "1.5px solid var(--color-ink-hairline-4)" }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className={`font-sans font-bold text-[12.5px] ${active ? "text-ink" : "text-ink/75"}`}>{t.name}</span>
                    <span className="font-mono text-[10px] text-ink-muted">{t.line}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Function the phone form carries that the design card keeps out of
              the way — folded, so the first paint stays the design's. */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className="mt-4 font-mono text-[10px] text-ink-muted transition-cu-state hover:text-ink"
          >
            {moreOpen ? "− fewer options" : "+ header photo, mark, home court, size, timezone"}
          </button>
          {moreOpen && (
            <div className="mt-3 flex flex-col gap-5">
              <div className="rounded-card overflow-hidden border border-ink-hairline-2">
                <CircleCardArt
                  circleId="new"
                  headerImage={header}
                  colour={colour}
                  emblem={emblem || initials}
                  name={trimmedName || "Your Circle"}
                />
              </div>
              <HeaderPicker selected={header} onChange={setHeader} />
              <EmblemPicker emblem={emblem} onChange={setEmblem} />
              {venueOptions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="wide-home-venue" className="text-cu-body font-semibold text-ink">
                    Home court (optional)
                  </label>
                  <select id="wide-home-venue" value={homeVenueId} onChange={(e) => setHomeVenueId(e.target.value)} className={fieldClass}>
                    <option value="">Automatic (where you play)</option>
                    {venueOptions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <label htmlFor="wide-max-members" className="text-cu-body font-semibold text-ink">
                  Max players (optional)
                </label>
                <input
                  id="wide-max-members"
                  type="number"
                  inputMode="numeric"
                  min={MIN_MAX_MEMBERS}
                  max={MAX_MAX_MEMBERS}
                  value={maxMembers}
                  onChange={(e) => setMaxMembers(e.target.value)}
                  placeholder="No limit"
                  className={fieldClass}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="wide-timezone" className="text-cu-body font-semibold text-ink">
                  Timezone
                </label>
                <select id="wide-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={fieldClass}>
                  {TIMEZONE_PRESETS.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <Button type="submit" size="lg" fullWidth pending={status === "saving"} disabled={!name.trim()} className="mt-4">
            {status === "saving" ? "Creating…" : "Create the Circle"}
          </Button>
          {status === "error" && (
            <Meta as="p" tone="action" className="mt-2">
              {CREATE_ERROR_COPY[errorCode] ?? CREATE_ERROR_COPY.something_went_wrong}
            </Meta>
          )}
        </div>
      </div>
    </form>
  );
}
