"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Fact, Meta } from "@/components/ui";

/**
 * The row grammar shared by two "bank statement" surfaces in the app: the
 * Glass Ledger (design/HANDOFF.md screen 9 — "the hero transparency moment")
 * and the Tab's activity log (screen 10 — "reuses the SAME row grammar as
 * the rating Ledger"). One component, two call sites
 * (components/glass/ledger-entry.tsx and the Tab's activity section), so a
 * future change to "what a fact row looks like" only happens once.
 *
 * A row is: headline + mono value on top, an optional muted meta line, an
 * optional coral-accented "why" explanation, an optional expandable detail
 * grid (the Ledger's factors; the Tab has none), and an optional trailing
 * balance line (the Ledger's running total; the Tab shows its own header
 * instead, so its activity rows omit this).
 */
export interface LedgerRowProps {
  headline: ReactNode;
  /** Mono fact on the right of the headline — a Glass delta, a money amount, or a status glyph. */
  value: ReactNode;
  /** Small mono context line under the headline — a date, a venue, a plain "why" for simple rows. */
  meta?: ReactNode;
  /** A fuller plain-language explanation, set off with the coral accent rule the Ledger uses for its "why". */
  why?: ReactNode;
  /** Expandable factor detail (Ledger only) — presence of this prop makes the row tappable. */
  details?: ReactNode;
  /** Right-aligned mono running-balance footer (Ledger only). */
  balance?: { label: string; value: ReactNode };
  /** Dims the row — the Tab's settled entries render at reduced opacity, same as a closed book entry. */
  quiet?: boolean;
}

export function LedgerRow({ headline, value, meta, why, details, balance, quiet = false }: LedgerRowProps) {
  const [open, setOpen] = useState(false);
  const expandable = !!details;

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-cu-body text-ink font-bold">{headline}</div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          {value}
          {expandable && (
            <span
              aria-hidden
              className="text-ink-muted transition-transform duration-[250ms]"
              style={{ transform: open ? "rotate(90deg)" : "none" }}
            >
              &#8250;
            </span>
          )}
        </div>
      </div>
      {meta && <Meta as="div" className="mt-1">{meta}</Meta>}
      {why && (
        <div className="mt-2 border-l-2 border-action pl-2.5">
          <p className="text-cu-secondary text-ink">{why}</p>
        </div>
      )}
      {balance && (
        <div className="flex items-center justify-between mt-2">
          <Meta>{balance.label}</Meta>
          <Fact size="sm" weight="semibold">{balance.value}</Fact>
        </div>
      )}
    </>
  );

  if (!expandable) {
    return <div className={`px-4 py-3 border-b border-ink-hairline-1 last:border-b-0 ${quiet ? "opacity-55" : ""}`}>{body}</div>;
  }

  return (
    <div className={`border-b border-ink-hairline-1 last:border-b-0 ${quiet ? "opacity-55" : ""}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="w-full text-left px-4 py-3">
        {body}
      </button>
      {open && <div className="px-4 pb-3 -mt-1">{details}</div>}
    </div>
  );
}
