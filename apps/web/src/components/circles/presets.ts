import { CIRCLE_COLORS } from "@/lib/design";
import { HEADER_KEYS, type HeaderKey } from "@/lib/circle-headers";

// A row of one-tap suggested emoji marks for a Circle, padel-adjacent and a
// little playful — the flag your four rallies under, not a mascot. The text
// field beside the picker still accepts any single emoji, so this is a
// starting point, never a cage.
export const EMBLEM_PRESETS = ["🎾", "🦆", "🔥", "⚡", "🏆", "🌊", "🦖", "👑", "🍺", "🌙"] as const;

// The 8 curated Circle colours (design/HANDOFF.md) — a Circle's colour
// identifies it everywhere (header, avatars, chat) but never carries an
// action; marks always render white on top of it.
export const COLOUR_PRESETS = CIRCLE_COLORS;

// Human names for each curated header, in HEADER_KEYS order (lib/circle-headers.ts).
// Presentational only — accessible labels for the picker thumbnails and <img>
// alt text. The keys themselves are the load-bearing identifiers; these are the
// words a person reads. Kept here (UI territory) rather than in the pure
// contract file so the header collection stays zero-dep.
const HEADER_LABEL_LIST = [
  "Full court, glass walls",
  "Court through the glass",
  "Sunlit court",
  "Mid-rally",
  "After the game",
  "Volley at the net",
  "Reaching for a smash",
  "Kit on the court",
  "Player, court-side",
  "Ready at the baseline",
  "Ball on the line",
  "Portrait on court",
] as const;

export const HEADER_LABELS: Record<HeaderKey, string> = Object.fromEntries(
  HEADER_KEYS.map((k, i) => [k, HEADER_LABEL_LIST[i] ?? "Padel court"]),
) as Record<HeaderKey, string>;

export const TIMEZONE_PRESETS = [
  { value: "Europe/London", label: "London (UK)" },
  { value: "Europe/Dublin", label: "Dublin" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Stockholm", label: "Stockholm" },
  { value: "America/New_York", label: "New York" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const;
