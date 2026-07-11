"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Meta, Fact, Button, Avatar } from "@/components/ui";

/** Serializable mirror of server/open-door.ts's CircleKnockView. */
export interface KnockPanelItem {
  knockId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number | null;
  /** Rating certainty 0..1 — the wide join-request row's "conf 63%" fact. Only meaningful alongside a non-null rating. */
  confidence: number;
  reliability: number | null;
  distanceLabel: string | null;
  message: string | null;
}

function ratingLabel(rating: number | null): string {
  return rating != null ? rating.toFixed(2) : "unrated";
}

function KnockRow({ item }: { item: KnockPanelItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState(false);

  async function decide(action: "accept" | "decline") {
    setBusy(action);
    setError(false);
    try {
      const res = await fetch(`/api/knocks/circle/${item.knockId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(true);
        setBusy(null);
      }
    } catch {
      setError(true);
      setBusy(null);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Avatar src={item.avatarUrl} name={item.displayName} size="md" />
        <div className="flex-1 min-w-0">
          <p className="text-cu-body font-bold text-ink truncate">{item.displayName}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
            <Meta>
              Glass <Fact as="span" size="sm" className="text-ink-muted">{ratingLabel(item.rating)}</Fact>
            </Meta>
            {item.reliability != null && (
              <Meta>
                Reliability <Fact as="span" size="sm" className="text-ink-muted">{Math.round(item.reliability * 100)}%</Fact>
              </Meta>
            )}
            {item.distanceLabel && <Meta>{item.distanceLabel}</Meta>}
          </div>
        </div>
      </div>
      {item.message && <p className="text-cu-secondary text-ink-muted">&ldquo;{item.message}&rdquo;</p>}
      <div className="flex items-center gap-2">
        <Button variant="strong" onClick={() => decide("accept")} pending={busy === "accept"} disabled={busy != null} fullWidth>
          Accept
        </Button>
        <Button variant="quiet" onClick={() => decide("decline")} pending={busy === "decline"} disabled={busy != null}>
          Decline
        </Button>
      </div>
      {error && <Meta tone="loss">That didn&apos;t go through. Give it another tap.</Meta>}
    </Card>
  );
}

export function KnockPanel({ knocks }: { knocks: KnockPanelItem[] }) {
  if (knocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-cu-body font-bold text-ink">
        Asks to join · {knocks.length}
      </p>
      <Meta as="p">Players near your patch asking to join. You decide.</Meta>
      <div className="flex flex-col gap-2 mt-1">
        {knocks.map((k) => (
          <KnockRow key={k.knockId} item={k} />
        ))}
      </div>
    </div>
  );
}
