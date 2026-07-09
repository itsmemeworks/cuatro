"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Meta } from "@/components/ui";
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
  const [description, setDescription] = useState("");
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
        body: JSON.stringify({
          circleId,
          totalAmountMinor,
          currency: defaultCurrency,
          debtorUserIds: selected,
          description: description.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body.error ?? "something_went_wrong");
        return;
      }
      setAmount("");
      setDescription("");
      setSelected([]);
      router.refresh();
    } catch {
      setError("network_error");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card as="form" onSubmit={submit} className="tab-add-entry-form flex flex-col gap-3">
      <p className="text-cu-card-title text-ink">Add to the Tab</p>

      <label className="tab-add-entry-form__amount-field flex flex-col gap-1">
        <Meta>You paid</Meta>
        <input
          className="tab-add-entry-form__amount rounded-button px-3 py-2 text-cu-body font-mono tabular-nums bg-ground border border-ink-hairline-2 text-ink"
          inputMode="decimal"
          placeholder="32.00"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </label>

      <label className="tab-add-entry-form__description-field flex flex-col gap-1">
        <Meta>What for (optional)</Meta>
        <input
          className="tab-add-entry-form__description rounded-button px-3 py-2 text-cu-body bg-ground border border-ink-hairline-2 text-ink"
          type="text"
          placeholder="court + balls"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className="tab-add-entry-form__debtors flex flex-col gap-1.5">
        <Meta>Split with</Meta>
        {debtorChoices.length === 0 ? (
          <p className="text-cu-secondary text-ink-muted">No other members in this Circle yet.</p>
        ) : (
          debtorChoices.map((m) => (
            <label key={m.userId} className="tab-add-entry-form__debtor flex items-center gap-2 text-cu-body text-ink">
              <input type="checkbox" checked={selected.includes(m.userId)} onChange={() => toggle(m.userId)} className="h-4 w-4" />
              {m.displayName}
            </label>
          ))
        )}
      </div>

      {error && (
        <Meta as="p" tone="loss" className="tab-add-entry-form__error">
          {error}
        </Meta>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        disabled={pending || debtorChoices.length === 0}
        className="tab-add-entry-form__submit"
      >
        Add to the Tab
      </Button>
    </Card>
  );
}
