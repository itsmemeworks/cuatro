"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui";
import { AddEntryForm, type AddEntryFormMember } from "./add-entry-form";

/**
 * "Add to the Tab" demoted to a compact affordance (design/DESIGN-AUDIT.md
 * T1) — the prototype's Tab screen has no open form up top; adding a split
 * is a quiet "+ Add" that opens the existing form in a sheet instead.
 * AddEntryForm itself is untouched — only its container changes.
 */
export function AddEntrySheet({
  circleId,
  members,
  payerUserId,
  defaultCurrency,
}: {
  circleId: string;
  members: AddEntryFormMember[];
  payerUserId: string;
  defaultCurrency: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-end rounded-chip border border-ink-hairline-3 text-ink font-bold text-[11px] px-3.5 py-2 transition-cu-state active:opacity-80"
      >
        + Add
      </button>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <AddEntryForm circleId={circleId} members={members} payerUserId={payerUserId} defaultCurrency={defaultCurrency} />
      </Sheet>
    </>
  );
}
