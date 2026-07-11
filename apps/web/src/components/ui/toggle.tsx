"use client";

/**
 * The design system's switch (extracted from door-controls so profile
 * settings can share it): coral when on, hairline when off, 44px-adjacent
 * touch target via the row that hosts it.
 */
export function Toggle({
  checked,
  onToggle,
  label,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full shrink-0 transition-cu-state ${checked ? "bg-action" : "bg-ink-hairline-3"} disabled:opacity-50`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`}
        aria-hidden
      />
    </button>
  );
}
