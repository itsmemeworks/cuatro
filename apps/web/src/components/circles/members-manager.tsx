"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, Chip, Meta, Sheet } from "@/components/ui";
import { removeMemberAction, transferOrganiserAction } from "@/app/(app)/circles/[id]/lifecycle-actions";
import type { MemberListItem } from "./member-list";

// Page-local copy for this surface's error codes.
const MANAGE_ERROR_COPY: Record<string, string> = {
  not_an_organiser: "Only an organiser can manage the roster.",
  not_a_member: "You're not in this Circle any more.",
  target_not_a_member: "That player has already left this Circle.",
  cannot_remove_self: "Use Leave this Circle to remove yourself.",
  cannot_transfer_to_self: "You're already an organiser.",
  cannot_transfer_to_guest: "Guests can't be organisers. Pick a member who's signed in.",
  unauthorized: "You've been signed out. Sign in and try again.",
  something_went_wrong: "That didn't go through. Give it another go.",
};

type PendingAction = { userId: string; kind: "remove" | "transfer" };

/**
 * Organiser-only roster management (Members tab). One quiet trigger opens a
 * Sheet listing every other member with two calm actions: hand over the
 * organiser role, or remove them. Both are confirm-first (the row swaps to an
 * inline "are you sure" before it fires) and neither is coral — removal never
 * shouts. Guest members can't be made organisers, so that action is hidden for
 * them (and re-blocked server-side).
 */
export function MembersManager({
  circleId,
  members,
  currentUserId,
}: {
  circleId: string;
  members: MemberListItem[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<PendingAction | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const others = members.filter((m) => m.userId !== currentUserId);
  if (others.length === 0) return null;

  function close() {
    setOpen(false);
    setConfirming(null);
    setError(null);
  }

  function run(action: PendingAction) {
    setError(null);
    startTransition(async () => {
      const res =
        action.kind === "remove"
          ? await removeMemberAction(circleId, action.userId)
          : await transferOrganiserAction(circleId, action.userId);
      if (res.ok) {
        setConfirming(null);
        // A transfer strips the caller's organiser role, so the whole surface
        // (and this Sheet) is about to disappear on refresh — close it.
        if (action.kind === "transfer") setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <>
      <Button variant="quiet" fullWidth onClick={() => setOpen(true)}>
        Manage members
      </Button>

      <Sheet open={open} onClose={close} title="Manage members">
        <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto pr-1 -mr-1">
          <Meta as="p">Hand over the organiser role, or remove someone. Their match history and Ledger always stay.</Meta>

          {others.map((m) => {
            const isConfirmingRemove = confirming?.userId === m.userId && confirming.kind === "remove";
            const isConfirmingTransfer = confirming?.userId === m.userId && confirming.kind === "transfer";
            return (
              <div key={m.userId} className="rounded-button border border-ink-hairline-2 p-3 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Avatar src={m.avatarUrl} name={m.displayName} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-cu-body font-bold text-ink truncate">{m.displayName}</span>
                      {m.role === "organiser" && (
                        <Chip tone="neutral" className="text-[9px] tracking-[0.06em]">
                          ORGANISER
                        </Chip>
                      )}
                    </div>
                  </div>
                </div>

                {isConfirmingRemove ? (
                  <div className="flex flex-col gap-2">
                    <Meta as="p">Remove {m.displayName} from this Circle? They keep their history.</Meta>
                    <div className="flex gap-2">
                      <Button variant="destructiveQuiet" fullWidth onClick={() => run({ userId: m.userId, kind: "remove" })} disabled={pending}>
                        {pending ? "Removing…" : "Remove"}
                      </Button>
                      <Button variant="quiet" fullWidth onClick={() => setConfirming(null)} disabled={pending}>
                        Keep
                      </Button>
                    </div>
                  </div>
                ) : isConfirmingTransfer ? (
                  <div className="flex flex-col gap-2">
                    <Meta as="p">Make {m.displayName} the organiser? You&apos;ll step back to member.</Meta>
                    <div className="flex gap-2">
                      <Button variant="strong" fullWidth onClick={() => run({ userId: m.userId, kind: "transfer" })} disabled={pending}>
                        {pending ? "Handing over…" : "Make organiser"}
                      </Button>
                      <Button variant="quiet" fullWidth onClick={() => setConfirming(null)} disabled={pending}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {!m.isGuest && m.role !== "organiser" && (
                      <Button variant="quiet" fullWidth onClick={() => { setError(null); setConfirming({ userId: m.userId, kind: "transfer" }); }}>
                        Make organiser
                      </Button>
                    )}
                    <Button variant="destructiveQuiet" fullWidth onClick={() => { setError(null); setConfirming({ userId: m.userId, kind: "remove" }); }}>
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {error && <Meta tone="loss">{MANAGE_ERROR_COPY[error] ?? MANAGE_ERROR_COPY.something_went_wrong}</Meta>}
        </div>
      </Sheet>
    </>
  );
}
