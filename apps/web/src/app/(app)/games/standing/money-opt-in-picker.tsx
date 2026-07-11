"use client";

import { useState } from "react";
import { Meta } from "@/components/ui";
import { BOOKING_PLATFORMS, type BookingPlatformId, bookingPlatform } from "@/lib/booking";
import { formatMoneyWhole, parseAmountToMinor } from "@/components/tab/money";

/**
 * The MONEY section of the Standing Game forms (GitHub issue #21; design
 * "Circle · Settings" standing-game card). A game carries no money by default;
 * the organiser may pick ONE of two opt-ins, never both:
 *   - "Booked on": a platform signpost (two-letter tiles, never logos) plus an
 *     optional pasted booking URL. Booked-on games never touch the Tab.
 *   - "Goes on the Tab": the existing court cost, split when the game seals.
 * Picking one clears the other in the form (the server enforces the same XOR);
 * tapping the active choice's dot again returns the game to silence.
 *
 * Everything here is CONTROLLED state (never uncontrolled defaults), so the
 * React 19 form-reset after a server action can't revert what's on screen
 * (CLAUDE.md #14).
 *
 * Submitted fields (contract with server/games-actions.ts):
 *   bookingPlatform: "" clears, a valid platform id sets
 *   bookingUrl:      "" clears, a pasted https URL sets (booking mode only)
 *   costAmount:      "" clears, "32.00"-style sets (cost mode only)
 */
export function MoneyOptInPicker({
  defaultPlatform = null,
  defaultUrl = null,
  defaultCostLabel = "",
  slots = 4,
  currency = "GBP",
}: {
  defaultPlatform?: string | null;
  defaultUrl?: string | null;
  defaultCostLabel?: string;
  /** For the "£8 each" split preview only; the real split happens on the Tab. */
  slots?: number;
  currency?: string;
}) {
  type Mode = "none" | "booking" | "cost";
  const initialPlatform = bookingPlatform(defaultPlatform)?.id ?? null;
  const [mode, setMode] = useState<Mode>(initialPlatform ? "booking" : defaultCostLabel ? "cost" : "none");
  const [platform, setPlatform] = useState<BookingPlatformId | null>(initialPlatform);
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [showUrlField, setShowUrlField] = useState(Boolean(defaultUrl));
  const [costLabel, setCostLabel] = useState(defaultCostLabel);

  const booking = mode === "booking";
  const cost = mode === "cost";

  function pickPlatform(id: BookingPlatformId) {
    if (booking && platform === id) {
      // Tapping the chosen tile again returns the game to silence.
      setPlatform(null);
      setMode("none");
      return;
    }
    setPlatform(id);
    setMode("booking"); // booking silences the cost
  }

  function toggleRow(next: Exclude<Mode, "none">) {
    if (mode === next) {
      setMode("none");
      if (next === "booking") setPlatform(null);
      return;
    }
    setMode(next);
    if (next === "booking" && platform === null) setPlatform(BOOKING_PLATFORMS[0].id);
  }

  const costMinor = cost ? parseAmountToMinor(costLabel.trim()) : null;
  const perHead = costMinor != null && slots >= 2 ? Math.floor(costMinor / slots) : null;

  const dot = (active: boolean) => (
    <span
      aria-hidden
      className="w-[15px] h-[15px] rounded-full box-border flex-none"
      style={active ? { border: "5px solid var(--color-action)" } : { border: "1.5px solid var(--color-ink-hairline-4)" }}
    />
  );

  return (
    <div className="rounded-button border border-ink-hairline-3 bg-surface p-3 flex flex-col gap-3">
      {/* The XOR travels as explicit values so a save can CLEAR either side. */}
      <input type="hidden" name="bookingPlatform" value={booking && platform ? platform : ""} />
      <input type="hidden" name="bookingUrl" value={booking ? url.trim() : ""} />
      <input type="hidden" name="costAmount" value={cost ? costLabel : ""} />

      <div className="flex items-baseline gap-2">
        <span className="font-sans font-extrabold text-[10px] tracking-[0.14em] text-ink-muted">MONEY</span>
        <Meta as="span">optional. Most games carry none, pick either or neither</Meta>
      </div>

      {/* Booked on */}
      <div className="flex items-start gap-2.5">
        <button type="button" onClick={() => toggleRow("booking")} aria-pressed={booking} aria-label="Booked on" className="mt-1">
          {dot(booking)}
        </button>
        <button
          type="button"
          onClick={() => toggleRow("booking")}
          className={`font-sans font-bold text-[12px] w-[104px] text-left mt-0.5 transition-cu-state hover:text-ink ${booking ? "text-ink" : "text-ink-muted"}`}
        >
          Booked on
        </button>
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-x-3.5 gap-y-2 flex-wrap">
            {BOOKING_PLATFORMS.map((p) => {
              const active = booking && platform === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickPlatform(p.id)}
                  aria-pressed={active}
                  className="inline-flex items-center gap-1.5 transition-cu-state hover:opacity-80"
                >
                  <span
                    aria-hidden
                    className={`w-6 h-6 rounded-[8px] flex items-center justify-center font-sans font-extrabold text-[10px] transition-cu-state ${
                      active ? "bg-ink text-ground" : "bg-ink-hairline-2 text-ink/75"
                    }`}
                  >
                    {p.tile}
                  </span>
                  <span className={`font-mono text-[10px] ${active ? "text-ink" : "text-ink-muted"}`}>{p.label}</span>
                </button>
              );
            })}
          </div>
          {booking &&
            (showUrlField ? (
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                aria-label="Booking link"
                className="rounded-button p-2.5 text-[12px] bg-ground border border-ink-hairline-3 text-ink outline-none placeholder:text-ink-muted"
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowUrlField(true)}
                className="font-mono text-[10px] text-ink-muted text-left transition-cu-state hover:text-ink"
              >
                + paste a booking link
              </button>
            ))}
        </div>
      </div>

      {/* Goes on the Tab */}
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={() => toggleRow("cost")} aria-pressed={cost} aria-label="Goes on the Tab" className="flex-none">
          {dot(cost)}
        </button>
        <button
          type="button"
          onClick={() => toggleRow("cost")}
          className={`font-sans font-bold text-[12px] w-[104px] text-left transition-cu-state hover:text-ink ${cost ? "text-ink" : "text-ink-muted"}`}
        >
          Goes on the Tab
        </button>
        {cost ? (
          <>
            <input
              type="text"
              inputMode="decimal"
              value={costLabel}
              onChange={(e) => setCostLabel(e.target.value)}
              placeholder="32.00"
              aria-label="Court cost"
              className="rounded-[9px] px-3 py-1.5 w-[88px] text-[12px] font-bold bg-ground border border-ink-hairline-3 text-ink outline-none placeholder:text-ink-muted placeholder:font-normal"
            />
            {perHead != null && (
              <span className="font-mono text-[10.5px] text-win">
                {formatMoneyWhole(perHead, currency)} each
              </span>
            )}
          </>
        ) : (
          <Meta as="span">court cost, split on the Tab</Meta>
        )}
      </div>

      <Meta as="p">booked-on games never touch the Tab. The split appears only when a cost is added</Meta>
    </div>
  );
}
