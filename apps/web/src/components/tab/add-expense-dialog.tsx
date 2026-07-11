"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";
import { equalSplitPreview, formatMoneyWhole, parseAmountToMinor } from "./money";
import type { AddEntryFormMember } from "./add-entry-form";

/**
 * The wide (≥900px) add-expense flow (design/CUATRO-Web-LATEST.dc.html "Add
 * expense"): a centred dialog with what-for pills, a big mono amount, the
 * fixed payer (you), split-among member pills, and a LIVE split preview that
 * narrates the floor-per-debtor penny rule before anything is written. Same
 * server path as the phone sheet — POST /api/tab/entries into server/tab.ts's
 * addSplitEntry; the maths lives there, equalSplitPreview only mirrors it for
 * display. The phone keeps its AddEntrySheet untouched.
 *
 * All fields are controlled and the dialog closes on success (React 19
 * auto-reset rule, CLAUDE.md #14 — save-then-close).
 */

const WHAT_FOR_PRESETS = [
  { id: "court", label: "Court", description: "court" },
  { id: "balls", label: "Balls", description: "balls" },
  { id: "other", label: "Other", description: null },
] as const;

type WhatForId = (typeof WHAT_FOR_PRESETS)[number]["id"];

export function AddExpenseDialog({
  circleId,
  circleName,
  members,
  payerUserId,
  defaultCurrency,
}: {
  circleId: string;
  circleName: string;
  members: AddEntryFormMember[];
  payerUserId: string;
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [whatFor, setWhatFor] = useState<WhatForId>("court");
  const [otherDescription, setOtherDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const payer = members.find((m) => m.userId === payerUserId) ?? null;
  const others = useMemo(() => members.filter((m) => m.userId !== payerUserId), [members, payerUserId]);
  // The common case is "the four splits the court" — start with everyone in,
  // taps take people out (the design's "tap to change").
  const [selected, setSelected] = useState<string[]>(() => others.map((m) => m.userId));

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function toggle(userId: string) {
    setSelected((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  const amountMinor = parseAmountToMinor(amount);
  const preview = amountMinor != null && amountMinor > 0 && selected.length > 0 ? equalSplitPreview(amountMinor, selected.length) : null;

  const splitNames = [
    "you",
    ...others.filter((m) => selected.includes(m.userId)).map((m) => m.displayName.split(" ")[0]),
  ];
  const splitNamesLabel =
    splitNames.length === 1 ? "just you" : `${splitNames.slice(0, -1).join(", ")} & ${splitNames[splitNames.length - 1]}`;

  async function submit() {
    setError(null);
    if (amountMinor === null || amountMinor <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (selected.length === 0) {
      setError("Pick who's splitting this");
      return;
    }
    const description = whatFor === "other" ? otherDescription.trim() || undefined : WHAT_FOR_PRESETS.find((p) => p.id === whatFor)?.description ?? undefined;

    setPending(true);
    try {
      const res = await fetch("/api/tab/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          circleId,
          totalAmountMinor: amountMinor,
          currency: defaultCurrency,
          debtorUserIds: selected,
          description,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(errorCopy(body.error));
        return;
      }
      // Save-then-close: reset AND unmount before anything can re-render stale.
      setOpen(false);
      setAmount("");
      setWhatFor("court");
      setOtherDescription("");
      setSelected(others.map((m) => m.userId));
      router.refresh();
    } catch {
      setError(errorCopy("network_error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[12px] border border-ink-hairline-3 text-ink font-bold text-[12px] px-4 py-2.5 whitespace-nowrap transition-cu-state hover:bg-ink-hairline-1 active:opacity-80"
      >
        + Add expense
      </button>

      {open && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Add expense, ${circleName}`}
            className="relative max-w-[520px] mx-auto mt-16 mb-10 bg-surface border border-ink-hairline-2 rounded-[22px] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-ink-hairline-1">
              <span className="flex-1 text-[11px] font-extrabold tracking-[0.14em] text-ink-muted uppercase">
                Add expense · {circleName}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-[13px] font-bold text-ink-muted transition-cu-state hover:text-ink"
              >
                ✕
              </button>
            </div>

            <div className="px-5 pt-[18px] pb-5">
              {/* what for */}
              <div className="flex gap-1.5 flex-wrap">
                {WHAT_FOR_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setWhatFor(p.id)}
                    className={`rounded-chip px-[15px] py-[7px] text-[12px] transition-cu-state ${
                      whatFor === p.id
                        ? "bg-strong-bg text-strong-fg font-bold hover:opacity-90"
                        : "border border-ink-hairline-3 text-ink font-semibold hover:bg-ink-hairline-1"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {whatFor === "other" && (
                <input
                  type="text"
                  value={otherDescription}
                  onChange={(e) => setOtherDescription(e.target.value)}
                  placeholder="what for (optional)"
                  className="mt-2.5 w-full rounded-button px-3 py-2 text-cu-body bg-ground border border-ink-hairline-2 text-ink"
                />
              )}

              {/* amount */}
              <label className="flex items-baseline gap-2.5 mt-4 bg-ground border border-ink-hairline-2 rounded-[14px] px-[18px] py-3.5 cursor-text">
                <span className="font-mono text-[12px] text-ink-muted">amount</span>
                <input
                  inputMode="decimal"
                  placeholder="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-right font-mono tabular-nums font-extrabold text-[30px] leading-none text-ink outline-none placeholder:text-ink-muted/40"
                  aria-label="Amount"
                />
              </label>

              {/* paid by — the server records the signed-in member as payer, so this states it rather than pretending it's a choice */}
              <div className="flex items-center gap-2 mt-3.5">
                <span className="font-mono text-[10px] text-ink-muted w-16 shrink-0">paid by</span>
                <span className="inline-flex items-center gap-1.5 rounded-chip bg-strong-bg text-strong-fg pl-1 pr-3 py-1 text-[11px] font-bold">
                  <Avatar name={payer?.displayName ?? "You"} size="xs" />
                  {payer ? payer.displayName.split(" ")[0] : "You"}
                </span>
                <span className="font-mono text-[10px] text-ink-muted">that&apos;s you</span>
              </div>

              {/* split among */}
              <div className="flex items-start gap-2 mt-2.5">
                <span className="font-mono text-[10px] text-ink-muted w-16 shrink-0 mt-1.5">split among</span>
                <div className="flex-1 min-w-0">
                  <div className="flex gap-1.5 flex-wrap">
                    {others.map((m) => {
                      const on = selected.includes(m.userId);
                      return (
                        <button
                          key={m.userId}
                          type="button"
                          onClick={() => toggle(m.userId)}
                          aria-pressed={on}
                          className={`rounded-chip px-3 py-1.5 text-[11px] transition-cu-state ${
                            on
                              ? "bg-strong-bg text-strong-fg font-bold hover:opacity-90"
                              : "border border-ink-hairline-3 text-ink-muted font-semibold hover:bg-ink-hairline-1"
                          }`}
                        >
                          {m.displayName.split(" ")[0]}
                        </button>
                      );
                    })}
                  </div>
                  <p className="font-mono text-[10.5px] text-ink-muted mt-1.5">
                    {selected.length === 0 ? "pick who's in on this one" : `${splitNamesLabel} · tap to change`}
                  </p>
                </div>
              </div>

              {/* live split preview — mirrors server/tab.ts computeEqualSplit */}
              <div className="mt-4 bg-ground border border-ink-hairline-1 rounded-[13px] px-4 py-3">
                {preview ? (
                  <p className="font-mono text-[12.5px] font-semibold text-win">
                    {formatMoneyWhole(amountMinor!, defaultCurrency)} split {preview.numPeople} ways ·{" "}
                    {formatMoneyWhole(preview.shareMinor, defaultCurrency)} a head
                    {preview.payerExtraMinor > 0 ? `, you absorb the ${preview.payerExtraMinor}p` : ""}
                  </p>
                ) : (
                  <p className="font-mono text-[12.5px] text-ink-muted">enter an amount and the split appears here</p>
                )}
                <p className="font-mono text-[10px] text-ink-muted mt-1">
                  if it doesn&apos;t split clean, the payer absorbs the remainder
                </p>
              </div>

              {error && <p className="font-mono text-[11px] text-loss mt-3">{error}</p>}

              <Button
                type="button"
                variant="primary"
                size="lg"
                fullWidth
                pending={pending}
                disabled={others.length === 0}
                onClick={submit}
                className="mt-3.5"
              >
                Put it on the Tab
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
