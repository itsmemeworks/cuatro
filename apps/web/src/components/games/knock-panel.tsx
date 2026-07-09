"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, Fact, Meta } from "@/components/ui";
import { PlayerLink } from "./roster";
import { errorCopy } from "@/lib/error-copy";

/**
 * Organiser-only panel on a session page: the pending asks (knocks) to join
 * this game, each with the asker's Glass, Reliability, and a coarse distance.
 * This page's one coral action is the RSVP card (StandingGameWeekCard), so
 * Accept is `strong` and Decline is `quiet` — no coral here.
 */
export interface KnockRow {
  knockId: string;
  /** The asker's user id, for the profile link. Optional: not every surface that renders a knock supplies it. Askers are always real users (guests can't knock), so no guest gate is needed. */
  userId?: string;
  displayName: string;
  avatarUrl: string | null;
  message: string | null;
  /** "Glass 3.40" or "Unrated" — pre-formatted server-side. */
  levelLabel: string;
  /** "Shows up 97%" or null before their first RSVP. */
  reliabilityLabel: string | null;
  lateCancelCount: number;
  distanceLabel: string | null;
}

export function KnockPanel({ knocks }: { knocks: KnockRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(knockId: string, decision: "accept" | "decline") {
    setBusyId(knockId);
    setError(null);
    try {
      const res = await fetch("/api/knocks/session/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knockId, decision }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(errorCopy(data?.error));
        return;
      }
      router.refresh();
    } catch {
      setError(errorCopy("network_error"));
    } finally {
      setBusyId(null);
    }
  }

  if (knocks.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-cu-secondary font-bold text-ink-muted">
          Asks to join{knocks.length > 1 ? ` · ${knocks.length}` : ""}
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        {knocks.map((k) => (
          <Card key={k.knockId} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              {k.userId ? (
                <PlayerLink userId={k.userId} className="shrink-0">
                  <Avatar src={k.avatarUrl} name={k.displayName} size="md" ring="ground" />
                </PlayerLink>
              ) : (
                <Avatar src={k.avatarUrl} name={k.displayName} size="md" ring="ground" />
              )}
              <div className="flex-1 min-w-0">
                {k.userId ? (
                  <PlayerLink userId={k.userId}>
                    <p className="text-cu-card-title text-[15px] truncate">{k.displayName}</p>
                  </PlayerLink>
                ) : (
                  <p className="text-cu-card-title text-[15px] truncate">{k.displayName}</p>
                )}
                <p className="text-cu-secondary text-ink-muted mt-0.5 truncate">
                  <Fact as="span" size="meta" tone="muted">
                    {k.levelLabel}
                  </Fact>
                  {k.reliabilityLabel ? ` · ${k.reliabilityLabel}` : ""}
                  {k.distanceLabel ? ` · ${k.distanceLabel}` : ""}
                </p>
              </div>
            </div>
            {k.message && <p className="text-cu-body text-ink">“{k.message}”</p>}
            {k.lateCancelCount > 0 && (
              <Meta as="p">
                {k.lateCancelCount} late cancel{k.lateCancelCount === 1 ? "" : "s"} on record
              </Meta>
            )}
            <div className="flex items-center gap-2">
              <Button variant="strong" fullWidth onClick={() => decide(k.knockId, "accept")} disabled={busyId === k.knockId}>
                Accept
              </Button>
              <Button variant="quiet" fullWidth onClick={() => decide(k.knockId, "decline")} disabled={busyId === k.knockId}>
                Decline
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {error && <p className="text-cu-secondary text-loss">{error}</p>}
    </section>
  );
}
