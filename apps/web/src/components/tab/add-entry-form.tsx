"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseAmountToMinor } from "./money";

export interface AddEntryFormMember {
  userId: string;
  displayName: string;
}

export function AddEntryForm({
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
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debtorChoices = members.filter((m) => m.userId !== payerUserId);

  function toggle(userId: string) {
    setSelected((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const totalAmountMinor = parseAmountToMinor(amount);
    if (totalAmountMinor === null || totalAmountMinor <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (selected.length === 0) {
      setError("Pick who owes for this");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/tab/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circleId, totalAmountMinor, currency: defaultCurrency, debtorUserIds: selected }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      setAmount("");
      setSelected([]);
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="tab-add-entry-form flex flex-col gap-3 rounded-2xl p-4"
      style={{ background: "var(--c4-bg-elevated)", border: "1px solid var(--c4-border)" }}
    >
      <p className="text-sm font-semibold">Add to the Tab</p>

      <label className="tab-add-entry-form__amount-field flex flex-col gap-1 text-xs" style={{ color: "var(--c4-text-muted)" }}>
        You paid
        <input
          className="tab-add-entry-form__amount rounded-lg px-3 py-2 text-sm font-mono"
          style={{
            background: "var(--c4-bg-elevated-2)",
            border: "1px solid var(--c4-border)",
            color: "var(--c4-text)",
          }}
          inputMode="decimal"
          placeholder="32.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>

      <div className="tab-add-entry-form__debtors flex flex-col gap-1">
        <span className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
          Split with
        </span>
        {debtorChoices.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--c4-text-muted)" }}>
            No other members in this Circle yet.
          </p>
        ) : (
          debtorChoices.map((m) => (
            <label key={m.userId} className="tab-add-entry-form__debtor flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(m.userId)} onChange={() => toggle(m.userId)} />
              {m.displayName}
            </label>
          ))
        )}
      </div>

      {error && (
        <p className="tab-add-entry-form__error text-xs" style={{ color: "var(--c4-danger)" }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || debtorChoices.length === 0}
        className="tab-add-entry-form__submit rounded-xl py-3 text-sm font-semibold"
        style={{
          minHeight: "var(--c4-touch-target)",
          background: "var(--c4-accent)",
          color: "var(--c4-accent-contrast)",
          opacity: pending || debtorChoices.length === 0 ? 0.6 : 1,
        }}
      >
        Add to the Tab
      </button>
    </form>
  );
}
