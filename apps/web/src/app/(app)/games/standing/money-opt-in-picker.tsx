"use client";

import { useEffect, useRef, useState } from "react";
import { Meta } from "@/components/ui";
import { BOOKING_PLATFORMS, type BookingPlatformId, bookingPlatform } from "@/lib/booking";
import { formatMoneyWhole, parseAmountToMinor } from "@/components/tab/money";

/**
 * Client mirror of the server's normalizeBookingUrl rule (standing-games-
 * service.ts): http(s) scheme AND a dotted hostname, so "https://x" is caught
 * here with CUATRO copy instead of surviving to the server (QA4). Empty is
 * fine — the URL is optional.
 */
function bookingUrlLooksValid(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return /^[^.]+(\.[^.]+)+$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

// Same voice as the forms' server-bounce copy for invalid_booking_url.
const URL_ERROR_COPY = "That link didn't read as a web address. Paste the full link, https and all.";

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
  allowCost = true,
}: {
  defaultPlatform?: string | null;
  defaultUrl?: string | null;
  defaultCostLabel?: string;
  /** For the "£8 each" split preview only; the real split happens on the Tab. */
  slots?: number;
  currency?: string;
  /** One-off sessions carry a "Booked on" signpost but no cost column, so their form hides the Tab row entirely. */
  allowCost?: boolean;
}) {
  type Mode = "none" | "booking" | "cost";
  const initialPlatform = bookingPlatform(defaultPlatform)?.id ?? null;
  const [mode, setMode] = useState<Mode>(initialPlatform ? "booking" : defaultCostLabel && allowCost ? "cost" : "none");
  const [platform, setPlatform] = useState<BookingPlatformId | null>(initialPlatform);
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [showUrlField, setShowUrlField] = useState(Boolean(defaultUrl));
  const [costLabel, setCostLabel] = useState(defaultCostLabel);
  const [showUrlError, setShowUrlError] = useState(false);

  const booking = mode === "booking";
  const cost = mode === "cost";

  // ---- Inline booking-URL validation (QA4): the input is type="text" (the
  // browser-native type="url" popup is not our voice), validated on blur and
  // on submit. The submit listener is native and attached to the parent form
  // directly (reached through the always-rendered hidden input): preventDefault
  // + stopPropagation fire before React's root-delegated handler, so an
  // invalid URL never reaches the server action.
  const formProbeRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const urlValidRef = useRef(true);
  urlValidRef.current = !booking || bookingUrlLooksValid(url);
  useEffect(() => {
    const form = formProbeRef.current?.form;
    if (!form) return;
    function onSubmit(e: Event) {
      if (urlValidRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      setShowUrlError(true);
      urlInputRef.current?.focus();
    }
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, []);
  const urlErrorVisible = showUrlError && !urlValidRef.current;

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
      <input ref={formProbeRef} type="hidden" name="bookingUrl" value={booking ? url.trim() : ""} />
      <input type="hidden" name="costAmount" value={cost ? costLabel : ""} />

      <div className="flex items-baseline gap-2">
        <span className="font-sans font-extrabold text-[10px] tracking-[0.14em] text-ink-muted">MONEY</span>
        <Meta as="span">{allowCost ? "optional. Most games carry none, pick either or neither" : "optional. Most games carry none"}</Meta>
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
              <>
                <input
                  ref={urlInputRef}
                  type="text"
                  inputMode="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => setShowUrlError(!urlValidRef.current)}
                  placeholder="https://…"
                  aria-label="Booking link"
                  aria-invalid={urlErrorVisible || undefined}
                  className={`rounded-button p-2.5 text-[12px] bg-ground border text-ink outline-none placeholder:text-ink-muted ${
                    urlErrorVisible ? "border-loss" : "border-ink-hairline-3"
                  }`}
                />
                {urlErrorVisible && (
                  <Meta as="p" tone="loss">
                    {URL_ERROR_COPY}
                  </Meta>
                )}
              </>
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
      {allowCost && (
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
      )}

      <Meta as="p">
        {allowCost
          ? "booked-on games never touch the Tab. The split appears only when a cost is added"
          : "booked-on games never touch the Tab"}
      </Meta>
    </div>
  );
}
