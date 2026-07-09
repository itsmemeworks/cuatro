"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Meta } from "@/components/ui";
import { EMBLEM_PRESETS, COLOUR_PRESETS, TIMEZONE_PRESETS } from "./presets";

const fieldClass =
  "w-full rounded-button px-4 py-3 text-[14px] outline-none bg-surface border border-ink-hairline-3 text-ink placeholder:text-ink-muted";

/**
 * "Make it yours" (Directions turn 10a) — name, then the colour + mark
 * picker with a live preview, exactly like the Circle-settings version of
 * this screen. One difference from the prototype: this is the *creation*
 * flow, so the venue-less preview badge stands in for the "Tue 8pm · 3 of 4
 * in" pinned chip the prototype shows for an existing Circle.
 */
export function CreateCircleForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [emblem, setEmblem] = useState<string>(EMBLEM_PRESETS[0]);
  const [colour, setColour] = useState<string>(COLOUR_PRESETS[0]);
  const [timezone, setTimezone] = useState<string>("Europe/London");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || status === "saving") return;
    setStatus("saving");
    try {
      const res = await fetch("/api/circles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, emblem, colour, timezone }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const { circle } = (await res.json()) as { circle: { id: string } };
      router.push(`/circles/${circle.id}`);
    } catch {
      setStatus("error");
    }
  }

  const initials = name.trim().slice(0, 2).toUpperCase() || "TN";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-cu-body font-semibold text-ink">
          Circle name
        </label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tuesday Night Lot"
          className={fieldClass}
        />
      </div>

      {/* Live preview — turn 10a's badge, repainting as colour/mark change. */}
      <Card className="flex items-center gap-4">
        <div
          className="w-[60px] h-[60px] rounded-card flex items-center justify-center shrink-0 transition-cu-state"
          style={{ background: colour }}
          aria-hidden
        >
          <span className="font-extrabold text-2xl text-white">{emblem || initials}</span>
        </div>
        <div className="min-w-0">
          <p className="text-cu-card-title text-ink truncate">{name.trim() || "Your Circle"}</p>
          <Meta as="p" className="mt-1">
            1 member · just created
          </Meta>
        </div>
      </Card>

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

      <div className="flex flex-col gap-2">
        <span className="text-cu-meta uppercase tracking-[0.14em] text-ink-muted">Mark</span>
        <div className="flex flex-wrap gap-2">
          {EMBLEM_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmblem(e)}
              aria-pressed={emblem === e}
              className={`w-11 h-11 rounded-button text-xl flex items-center justify-center transition-cu-state ${
                emblem === e ? "border-2 border-ink" : "border border-ink-hairline-3"
              } bg-surface`}
            >
              {e}
            </button>
          ))}
        </div>
        <Meta as="p" className="mt-1">
          marks stay geometric, this is a flag, not a mascot
        </Meta>
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
      {status === "error" && <Meta tone="action">Something went wrong, try again.</Meta>}
      <Meta as="p" className="text-center">
        coral stays the app&apos;s action colour, your colour identifies, it never asks
      </Meta>
    </form>
  );
}
