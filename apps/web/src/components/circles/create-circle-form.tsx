"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { COLOUR_PRESETS, EMBLEM_PRESETS, TIMEZONE_PRESETS } from "./presets";

const inputStyle = {
  background: "var(--c4-bg-elevated)",
  border: "1px solid var(--c4-border)",
  color: "var(--c4-text)",
  minHeight: "var(--c4-touch-target)",
};

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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-sm font-medium">
          Circle name
        </label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tuesday Shoreditch Crew"
          className="w-full rounded-xl px-4 py-3 text-base outline-none"
          style={inputStyle}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Emblem</span>
        <div className="flex flex-wrap gap-2">
          {EMBLEM_PRESETS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmblem(e)}
              aria-pressed={emblem === e}
              className="w-11 h-11 rounded-xl text-xl flex items-center justify-center"
              style={{
                background: emblem === e ? "var(--c4-accent)" : "var(--c4-bg-elevated)",
                border: "1px solid var(--c4-border)",
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Colour</span>
        <div className="flex flex-wrap gap-2">
          {COLOUR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColour(c)}
              aria-pressed={colour === c}
              aria-label={c}
              className="w-9 h-9 rounded-full"
              style={{
                background: c,
                border: colour === c ? "3px solid var(--c4-text)" : "1px solid var(--c4-border)",
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="timezone" className="text-sm font-medium">
          Timezone
        </label>
        <select
          id="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="w-full rounded-xl px-4 py-3 text-base outline-none"
          style={inputStyle}
        >
          {TIMEZONE_PRESETS.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={status === "saving" || !name.trim()}
        className="w-full rounded-xl font-semibold py-3.5 disabled:opacity-60"
        style={{
          background: "var(--c4-accent)",
          color: "var(--c4-accent-contrast)",
          minHeight: "var(--c4-touch-target)",
        }}
      >
        {status === "saving" ? "Creating…" : "Create Circle"}
      </button>
      {status === "error" && (
        <p className="text-sm" style={{ color: "var(--c4-danger)" }}>
          Something went wrong — try again.
        </p>
      )}
    </form>
  );
}
