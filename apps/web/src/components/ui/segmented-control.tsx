/**
 * The Feed / Chat / Members segmented control. Active segment uses the
 * same "strong" bone-on-dark inversion as the Strong button and toasts —
 * one visual language for "the emphasised thing here."
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** e.g. an unread count — rendered in the action colour, matching the Chat tab's "·2". */
  badge?: string | number;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex gap-1.5 ${className}`} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={[
              "rounded-chip px-4 py-2 text-[11.5px] transition-cu-state",
              active ? "bg-strong-bg text-strong-fg font-bold" : "bg-transparent text-ink font-semibold border border-ink-hairline-3",
            ].join(" ")}
          >
            {opt.label}
            {opt.badge != null && <span className="text-action font-extrabold ml-1">·{opt.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
