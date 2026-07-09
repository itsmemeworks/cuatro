"use client";

import { Meta } from "@/components/ui";
import { EMBLEM_PRESETS } from "./presets";

/**
 * Grapheme count via Intl.Segmenter (modern browsers). One user-perceived
 * emoji — including a flag or ZWJ family sequence — counts as one, so the
 * "one emoji is plenty" rule holds for composed emoji too. Mirrors the
 * server-side check in server/circles.ts so the UI can reject before the
 * round trip.
 */
export function countGraphemes(value: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length;
  }
  return [...value].length;
}

/** true when a non-empty emblem is more than a single grapheme cluster. */
export function isEmblemTooLong(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && countGraphemes(trimmed) !== 1;
}

const emblemFieldClass =
  "w-full rounded-button px-4 py-3 text-[14px] outline-none bg-surface border border-ink-hairline-3 text-ink placeholder:text-ink-muted";

/**
 * The Circle mark picker, shared by the create form and the edit sheet. The
 * quick-pick presets stay one-tap; the text field opens the native emoji
 * keyboard where the device offers one, and accepts any single emoji. Marks
 * always render white on the Circle colour, so the picker itself is calm.
 */
export function EmblemPicker({
  emblem,
  onChange,
}: {
  emblem: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-cu-meta uppercase tracking-[0.14em] text-ink-muted">Mark</span>
      <div className="flex flex-wrap gap-2">
        {EMBLEM_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-pressed={emblem.trim() === preset}
            className={`w-11 h-11 rounded-button text-xl flex items-center justify-center transition-cu-state ${
              emblem.trim() === preset ? "border-2 border-ink" : "border border-ink-hairline-3"
            } bg-surface`}
          >
            {preset}
          </button>
        ))}
      </div>
      <input
        type="text"
        inputMode="text"
        value={emblem}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Circle emoji"
        placeholder="or type any emoji"
        className={emblemFieldClass}
      />
      <Meta as="p">Pick a vibe, or type any emoji. It flies white on your Circle colour.</Meta>
    </div>
  );
}
