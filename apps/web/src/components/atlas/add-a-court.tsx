"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Meta, Sheet, useToast } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";
import {
  addCourtToAtlasAction,
  verifyPostcodeAction,
  type AddCourtResult,
  type DedupeVenue,
} from "@/app/(app)/atlas/actions";

/**
 * Add-a-court — the choose-or-add moment on THE ATLAS (design screen 5). A
 * court is a civic contribution, not a person and not a home-court pick: the
 * affordances here are NEVER dashed coral (dashed coral = a space waiting for a
 * person), the create does not touch the adder's own patch, and the payoff is a
 * one-beat amber celebration, never confetti.
 *
 * Three steps in one sheet:
 *  1. form   — name + postcode with live geocode feedback, optional
 *              indoor/outdoor + court count. One coral action: "Pin it".
 *  2. dedupe — shown only when the server found a near-match. The CORAL action
 *              accepts the EXISTING venue (duplicates are the failure mode);
 *              creating-anyway is the quiet option.
 *  3. done   — amber seal rise + "<name>, welcome to the Atlas". One coral
 *              action: "See it on the map".
 *
 * Self-contained island (the SettingsSheet pattern): renders its own trigger —
 * the list "Add a court" row (`variant="row"`) or the wide header pill
 * (`variant="button"`) — and drives the flow through server actions, so the
 * surfaces that host it (the Atlas list, the wide header) only drop it in.
 */

/** Page-local copy for the add-a-court result codes (convention #9: raw codes never reach the UI). */
const ADD_COURT_COPY: Record<string, string> = {
  court_name_missing: "Give the court a name so we can put it on the Atlas.",
  postcode_unresolved: "That postcode didn't land anywhere we know. Check it and try again.",
};
function addCourtCopy(code: string): string {
  return ADD_COURT_COPY[code] ?? errorCopy(code);
}

type PostcodeState = { ok: true; postcode: string } | { ok: false } | null;

export function AddACourt({
  variant = "row",
  className = "",
}: {
  variant?: "row" | "button";
  className?: string;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "dedupe" | "done">("form");

  const [name, setName] = useState("");
  const [postcode, setPostcode] = useState("");
  const [indoorOutdoor, setIndoorOutdoor] = useState<"indoor" | "outdoor" | "">("");
  const [courtCount, setCourtCount] = useState(0);

  const [pcCheck, setPcCheck] = useState<PostcodeState>(null);
  const [error, setError] = useState<string | null>(null);
  const [dedupe, setDedupe] = useState<{ submittedName: string; district: string | null; existing: DedupeVenue } | null>(null);
  const [done, setDone] = useState<{ name: string; district: string | null; venueId: string; slug: string | null } | null>(null);
  const [pending, startTransition] = useTransition();

  // Live postcode check, debounced. A request token guards against a slow
  // earlier lookup landing after a newer keystroke and overwriting it.
  const checkToken = useRef(0);
  useEffect(() => {
    const trimmed = postcode.trim();
    if (trimmed.length < 5) {
      setPcCheck(null);
      return;
    }
    const token = ++checkToken.current;
    const timer = setTimeout(async () => {
      const result = await verifyPostcodeAction(trimmed);
      if (token === checkToken.current) setPcCheck(result.ok ? { ok: true, postcode: result.postcode } : { ok: false });
    }, 450);
    return () => clearTimeout(timer);
  }, [postcode]);

  function reset() {
    setStep("form");
    setName("");
    setPostcode("");
    setIndoorOutdoor("");
    setCourtCount(0);
    setPcCheck(null);
    setError(null);
    setDedupe(null);
    setDone(null);
  }

  function close() {
    setOpen(false);
  }

  function applyResult(result: AddCourtResult) {
    if (result.status === "error") {
      setError(addCourtCopy(result.code));
      return;
    }
    setError(null);
    if (result.status === "dedupe") {
      setDedupe({ submittedName: result.submittedName, district: result.district, existing: result.existing });
      setStep("dedupe");
      return;
    }
    setDone({ name: result.name, district: result.district, venueId: result.venueId, slug: result.slug });
    setStep("done");
  }

  function submit(force: boolean) {
    const fd = new FormData();
    fd.set("name", name);
    fd.set("postcode", postcode);
    if (indoorOutdoor) fd.set("indoorOutdoor", indoorOutdoor);
    if (courtCount > 0) fd.set("courtCount", String(courtCount));
    if (force) fd.set("force", "1");
    startTransition(async () => {
      applyResult(await addCourtToAtlasAction(fd));
    });
  }

  // "That's the one" — accept the existing venue instead of splitting the
  // town in two. Its court page is the real destination (the design's venue
  // sheet is a wide-only overlay); if the match isn't slugged yet, we bow out
  // quietly with the reassurance that it's already on the Atlas.
  function acceptExisting() {
    const existing = dedupe?.existing;
    close();
    if (existing?.slug) {
      router.push(`/courts/${existing.slug}`);
    } else if (existing) {
      show(`${existing.name} is already on the Atlas`);
    }
  }

  function seeOnMap() {
    const created = done;
    close();
    if (created) show(`${created.name} is on the Atlas`);
    router.push("/discover");
    router.refresh();
  }

  const district = dedupe?.district ?? done?.district ?? null;

  const pcHint = pcCheck?.ok
    ? `✓ ${pcCheck.postcode} checks out · the pin lands there, roughly. Rough is the point`
    : pcCheck?.ok === false
      ? addCourtCopy("postcode_unresolved")
      : "the postcode places the pin, roughly. Rough is the point";

  const trigger =
    variant === "button" ? (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`shrink-0 rounded-full border border-ink-hairline-4 px-4 py-2 text-[12px] font-bold text-ink hover:bg-ink-hairline-1 transition-cu-state ${className}`}
      >
        + Add a court
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-3 rounded-2xl border border-ink-hairline-3 px-3.5 py-3 text-left hover:bg-ink-hairline-1 transition-cu-state ${className}`}
      >
        <span aria-hidden className="grid size-7 place-items-center rounded-full border border-ink-hairline-3 text-ink-muted text-[15px] leading-none">
          +
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-cu-body font-bold text-ink">Add a court</span>
          <Meta as="span">know one we don&apos;t? Put it on the Atlas</Meta>
        </span>
      </button>
    );

  return (
    <>
      {trigger}
      <Sheet open={open} onClose={close}>
        {step === "form" && (
          <div className="flex flex-col gap-0">
            <SheetHeader
              title="Add a court"
              sub="every court you add is visible to every player after you"
              onClose={close}
            />

            <label className="mt-4 block text-[10px] font-extrabold tracking-[0.13em] text-ink-muted">VENUE NAME</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hackney Wick Padel"
              className="mt-[7px] w-full rounded-[12px] border border-ink-hairline-2 bg-ground px-3.5 py-3 text-cu-body font-semibold text-ink outline-none"
            />

            <label className="mt-3.5 block text-[10px] font-extrabold tracking-[0.13em] text-ink-muted">POSTCODE</label>
            <input
              value={postcode}
              onChange={(e) => setPostcode(e.target.value.toUpperCase())}
              placeholder="E9 5EN"
              inputMode="text"
              autoCapitalize="characters"
              className="mt-[7px] w-[160px] rounded-[12px] border border-ink-hairline-2 bg-ground px-3.5 py-3 font-mono text-[13px] uppercase text-ink outline-none"
            />
            <Meta as="p" className="mt-[7px]" tone={pcCheck?.ok ? "win" : pcCheck?.ok === false ? "loss" : undefined}>
              {pcHint}
            </Meta>

            <p className="mt-4 text-[10px] font-extrabold tracking-[0.13em] text-ink-muted">
              OPTIONAL · THE COMMUNITY FILLS THE REST
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <div className="inline-flex gap-[3px] rounded-full border border-ink-hairline-2 bg-ground p-[3px]">
                {(["indoor", "outdoor"] as const).map((io) => {
                  const active = indoorOutdoor === io;
                  return (
                    <button
                      key={io}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setIndoorOutdoor(active ? "" : io)}
                      className={`rounded-full px-[13px] py-[7px] text-[11px] font-bold capitalize transition-cu-state ${active ? "bg-strong-bg text-strong-fg" : "text-ink-muted hover:text-ink"}`}
                    >
                      {io}
                    </button>
                  );
                })}
              </div>
              <div className="inline-flex items-center gap-2.5 rounded-full border border-ink-hairline-2 px-1.5 py-1">
                <button
                  type="button"
                  aria-label="one fewer court"
                  onClick={() => setCourtCount((n) => Math.max(0, n - 1))}
                  className="grid size-[26px] place-items-center rounded-full bg-ink-hairline-1 text-ink hover:bg-ink-hairline-2 transition-cu-state"
                >
                  −
                </button>
                <span className="min-w-[66px] text-center font-mono text-[12px] font-bold text-ink">
                  {courtCount === 0 ? "courts · ?" : `courts · ${courtCount}`}
                </span>
                <button
                  type="button"
                  aria-label="one more court"
                  onClick={() => setCourtCount((n) => Math.min(20, n + 1))}
                  className="grid size-[26px] place-items-center rounded-full bg-ink-hairline-1 text-ink hover:bg-ink-hairline-2 transition-cu-state"
                >
                  +
                </button>
              </div>
            </div>

            {error && (
              <Meta as="p" tone="loss" className="mt-3">
                {error}
              </Meta>
            )}

            <div className="mt-[18px]">
              <Button variant="primary" size="lg" fullWidth pending={pending} onClick={() => submit(false)}>
                Pin it to the Atlas
              </Button>
            </div>
            <Meta as="p" className="mt-2.5 text-center">
              no moderation queue. It earns trust as players call it home
            </Meta>
          </div>
        )}

        {step === "dedupe" && dedupe && (
          <div className="flex flex-col gap-0">
            <h2 className="text-[20px] font-extrabold text-ink">Hold on. Did you mean this one?</h2>
            <Meta as="p" className="mt-[5px]">
              you typed &ldquo;{dedupe.submittedName}&rdquo;{district ? ` in ${district}` : ""}. The Atlas already knows a
              court there.
            </Meta>

            <div className="mt-3.5 rounded-2xl border border-ink-hairline-2 bg-ground px-[15px] py-3.5">
              <p className="text-[14.5px] font-extrabold text-ink">{dedupe.existing.name}</p>
              {dedupe.existing.factsLine && (
                <Meta as="p" className="mt-1">
                  {dedupe.existing.factsLine}
                </Meta>
              )}
              <Meta as="p" className="mt-0.5">
                {dedupe.existing.homeCourtPlayers > 0
                  ? `home court to ${dedupe.existing.homeCourtPlayers} ${dedupe.existing.homeCourtPlayers === 1 ? "player" : "players"}`
                  : "no one calls it home yet"}
              </Meta>
            </div>

            <div className="mt-3.5">
              <Button variant="primary" size="lg" fullWidth onClick={acceptExisting}>
                That&apos;s the one
              </Button>
            </div>
            <div className="mt-2.5">
              <Button variant="quiet" fullWidth pending={pending} onClick={() => submit(true)}>
                No, mine is new · pin it
              </Button>
            </div>
            <Meta as="p" className="mt-2.5 text-center">
              one venue, one page. Duplicates split the town in two
            </Meta>
          </div>
        )}

        {step === "done" && done && (
          <div className="flex flex-col items-center py-2 text-center">
            <div
              aria-hidden
              className="grid size-[52px] place-items-center rounded-full border-2 border-streak bg-streak-tint text-[20px] font-extrabold text-streak animate-cu-seal"
            >
              ◆
            </div>
            <h2 className="mt-3.5 text-[21px] font-extrabold text-ink">{done.name}, welcome to the Atlas</h2>
            <Meta as="p" className="mt-2 leading-[1.7]">
              first court in {done.district ?? "town"} added by a player.
              <br />
              That player is you.
            </Meta>
            <div className="mt-4 w-full">
              <Button variant="primary" size="lg" fullWidth onClick={seeOnMap}>
                See it on the map
              </Button>
            </div>
            <Meta as="p" className="mt-2.5">
              {done.district ? `every player in ${done.district} can see it now` : "every player near it can see it now"} · it
              earns trust as players call it home
            </Meta>
          </div>
        )}
      </Sheet>
    </>
  );
}

function SheetHeader({ title, sub, onClose }: { title: string; sub: string; onClose: () => void }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex-1">
        <h2 className="text-[20px] font-extrabold text-ink">{title}</h2>
        <Meta as="p" className="mt-[5px]">
          {sub}
        </Meta>
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="grid size-[30px] place-items-center rounded-full bg-ink-hairline-1 text-ink-muted hover:bg-ink-hairline-2 transition-cu-state"
      >
        ×
      </button>
    </div>
  );
}
