// Small, deliberately limited preset palettes for Circle creation — no
// free-form color/emoji picker at v0 (see DESIGN.md's Build plan M1).
export const EMBLEM_PRESETS = ["🎾", "🏆", "🔥", "⚡", "🌊", "🦅", "🐺", "⭐"] as const;

export const COLOUR_PRESETS = ["#1F6FEB", "#D9822B", "#7DE0C8", "#F2755C", "#8B5CF6", "#E8B954"] as const;

export const TIMEZONE_PRESETS = [
  { value: "Europe/London", label: "London (UK)" },
  { value: "Europe/Dublin", label: "Dublin" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Stockholm", label: "Stockholm" },
  { value: "America/New_York", label: "New York" },
  { value: "Australia/Sydney", label: "Sydney" },
] as const;
