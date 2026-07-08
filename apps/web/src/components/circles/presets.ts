import { CIRCLE_COLORS } from "@/lib/design";

// Small, deliberately limited preset palettes for Circle creation — no
// free-form color/emoji picker at v0 (see DESIGN.md's Build plan M1).
export const EMBLEM_PRESETS = ["🎾", "🏆", "🔥", "⚡", "🌊", "🦅", "🐺", "⭐"] as const;

// The 8 curated Circle colours (design/HANDOFF.md) — a Circle's colour
// identifies it everywhere (header, avatars, chat) but never carries an
// action; marks always render white on top of it.
export const COLOUR_PRESETS = CIRCLE_COLORS;

export const TIMEZONE_PRESETS = [
  { value: "Europe/London", label: "London (UK)" },
  { value: "Europe/Dublin", label: "Dublin" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Stockholm", label: "Stockholm" },
  { value: "America/New_York", label: "New York" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const;
