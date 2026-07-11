"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, Button, Meta } from "@/components/ui";
import { SelfieCamera } from "@/components/entry/selfie-camera";
import { updateDisplayNameAction } from "@/lib/actions";
import { updateDiscoverySettingsAction } from "@/app/(app)/profile/discovery-actions";
import { updatePlayerAttrsAction } from "@/app/(app)/profile/player-attrs-actions";
import { COURT_SIDES, DOMINANT_HANDS } from "@/lib/player-attrs";
import { AttrSegments, courtSideSegmentLabel, type VenueOption } from "@/components/profile/settings-sheet";

/** Section shell — bone label + hairline card, matching the design's Settings cards. No coral here; the one strong action is Save (design/CUATRO-Web-LATEST.dc.html "Home · Settings"). */
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-ink-hairline-1 rounded-[20px] px-[18px] py-4">
      <p className="text-[10px] font-extrabold tracking-[0.14em] text-ink-muted">{label}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/**
 * The Settings switch. The design uses GREEN for a state toggle (coral is
 * reserved for actions, and Settings carries no coral), so this is a local
 * green switch rather than the app's coral-on ui/Toggle. Interactive when
 * `onToggle` is given; a bare `on` renders it read-only (the notification-type
 * rows, not yet wired to a preference store).
 */
function SettingToggle({ on, onToggle, disabled, label }: { on: boolean; onToggle?: () => void; disabled?: boolean; label?: string }) {
  const knob = <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? "right-0.5" : "left-0.5"}`} aria-hidden />;
  const base = `relative w-11 h-6 rounded-full shrink-0 ${on ? "bg-win" : "bg-ink-hairline-3"}`;
  if (!onToggle) return <div className={`${base} opacity-70`} aria-hidden>{knob}</div>;
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} disabled={disabled} className={`${base} disabled:opacity-50`}>
      {knob}
    </button>
  );
}

/**
 * The wide home-context Settings (design/CUATRO-Web-LATEST.dc.html "Home ·
 * Settings"): PROFILE (name + photo), YOUR PATCH (home venue), Findable, Sign
 * out, and the NOTIFICATIONS card. Reuses the existing server actions the
 * phone settings sheet uses — display name, discovery (findable + home
 * venue), logout — so there is no new mutation surface; this is the desktop
 * restatement of controls that already exist.
 *
 * ON COURT (issue #21, Wave C): the hand/side segmented pickers, saved on tap
 * through updatePlayerAttrsAction — soft signals only, both skippable, tapping
 * the active segment clears it. Deliberately NOT here: the
 * browser-notifications "Enable" row (desktop web push is Wave D). The three
 * notification-type rows render their current state — CUATRO sends all of
 * them today — but the per-type controls are not wired (no preference store
 * yet); they read as status, not as toggles that quietly fail to save.
 */
export function SettingsWide({
  displayName,
  email,
  avatarUrl,
  findable,
  homeVenueId,
  homeVenueName,
  venueOptions,
  dominantHand = null,
  courtSide = null,
}: {
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
  findable: boolean;
  homeVenueId: string | null;
  homeVenueName: string | null;
  venueOptions: VenueOption[];
  /** ON COURT attributes (issue #21) — the stored values; null renders both pickers unset. */
  dominantHand?: string | null;
  courtSide?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(displayName ?? "");
  const [avatar, setAvatar] = useState(avatarUrl);
  const [showCamera, setShowCamera] = useState(false);
  const [findableOn, setFindableOn] = useState(findable);
  const [venue, setVenue] = useState(homeVenueId ?? "");
  const [hand, setHand] = useState(dominantHand ?? "");
  const [side, setSide] = useState(courtSide ?? "");
  const [savingName, startSaveName] = useTransition();
  const [savingDiscovery, startSaveDiscovery] = useTransition();
  const [savingAttrs, startSaveAttrs] = useTransition();

  const nameDirty = name.trim() !== (displayName ?? "").trim() && name.trim().length > 0;

  function saveName() {
    const fd = new FormData();
    fd.set("displayName", name.trim());
    startSaveName(async () => {
      await updateDisplayNameAction(fd);
      router.refresh();
    });
  }

  // Findable + home venue share one server action (an absent `findable`
  // reads as "not findable"), so every discovery change submits BOTH current
  // values together — never one without the other.
  function saveDiscovery(nextFindable: boolean, nextVenue: string) {
    const fd = new FormData();
    if (nextFindable) fd.set("findable", "on");
    if (nextVenue) fd.set("homeVenueId", nextVenue);
    startSaveDiscovery(async () => {
      await updateDiscoverySettingsAction(fd);
      router.refresh();
    });
  }

  // Hand + side also share one action (both always submitted together), saved
  // on tap like the discovery controls — no Save button, the segment IS the
  // state. "" means unset and writes null.
  function saveAttrs(nextHand: string, nextSide: string) {
    const fd = new FormData();
    fd.set("dominantHand", nextHand);
    fd.set("courtSide", nextSide);
    startSaveAttrs(async () => {
      await updatePlayerAttrsAction(fd);
      router.refresh();
    });
  }

  return (
    <div>
      <Link href="/profile" className="text-cu-secondary font-bold text-action hover:underline">
        ‹ You
      </Link>
      <h1 className="text-[24px] leading-none font-extrabold text-ink mt-3">Settings</h1>

      <div className="grid grid-cols-1 min-[900px]:grid-cols-2 gap-4 mt-4 items-start">
        {/* left column */}
        <div className="flex flex-col gap-3.5">
          <Section label="PROFILE">
            <div className="flex items-center gap-3">
              <Avatar src={avatar} name={name || email} size="lg" />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="What should your Circles call you?"
                aria-label="Display name"
                className="flex-1 min-w-0 bg-ground border border-ink-hairline-2 rounded-[11px] px-3 py-2.5 text-[13px] font-semibold text-ink outline-none"
              />
              <button
                type="button"
                onClick={() => setShowCamera(true)}
                className="shrink-0 rounded-full border border-ink-hairline-3 px-3 py-2 text-[11px] font-bold text-ink hover:bg-ink-hairline-1 transition-cu-state"
              >
                Change photo
              </button>
            </div>
            {nameDirty && (
              <div className="mt-3">
                <Button type="button" variant="strong" onClick={saveName} pending={savingName}>
                  Save name
                </Button>
              </div>
            )}
            <Meta as="p" className="mt-2.5">{email}</Meta>
          </Section>

          <Section label="YOUR PATCH">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-ink truncate">{homeVenueName ?? "No home venue set"}</p>
                <Meta as="p" className="mt-0.5">Discover shows games around your patch, never GPS</Meta>
              </div>
            </div>
            <select
              value={venue}
              onChange={(e) => {
                setVenue(e.target.value);
                saveDiscovery(findableOn, e.target.value);
              }}
              disabled={savingDiscovery}
              aria-label="Home venue"
              className="w-full mt-3 bg-ground border border-ink-hairline-2 rounded-[11px] px-3 py-2.5 text-[13px] text-ink outline-none"
            >
              <option value="">No home venue</option>
              {venueOptions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Section>

          <Section label="ON COURT">
            <div className="flex items-center gap-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-bold text-ink">Hand</p>
                <Meta as="p" className="mt-0.5">which hand holds the racket</Meta>
              </div>
              <AttrSegments
                options={DOMINANT_HANDS.map((h) => ({ id: h.id, label: h.label }))}
                value={hand}
                onSelect={(next) => {
                  setHand(next);
                  saveAttrs(next, side);
                }}
                disabled={savingAttrs}
                label="Dominant hand"
              />
            </div>
            <div className="flex items-center gap-2.5 mt-3">
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] font-bold text-ink">Side</p>
                <Meta as="p" className="mt-0.5">where you set up in the pair</Meta>
              </div>
              <AttrSegments
                options={COURT_SIDES.map((s) => ({ id: s.id, label: courtSideSegmentLabel(s) }))}
                value={side}
                onSelect={(next) => {
                  setSide(next);
                  saveAttrs(hand, next);
                }}
                disabled={savingAttrs}
                label="Court side"
              />
            </div>
            <Meta as="p" className="mt-3">
              both optional, skip freely. Never touches Glass, the Rotation, or who can join
            </Meta>
          </Section>

          <div className="bg-surface border border-ink-hairline-1 rounded-[20px] px-[18px] py-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-ink">Findable</p>
              <Meta as="p" className="mt-0.5">people nearby can find you for a fourth</Meta>
            </div>
            <SettingToggle
              on={findableOn}
              onToggle={() => {
                const next = !findableOn;
                setFindableOn(next);
                saveDiscovery(next, venue);
              }}
              label="Findable"
              disabled={savingDiscovery}
            />
          </div>

          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="w-full border border-ink-hairline-3 rounded-2xl py-3 text-center text-[12.5px] font-bold text-ink-muted hover:bg-ink-hairline-1 hover:text-ink transition-cu-state"
            >
              Sign out
            </button>
          </form>
        </div>

        {/* right column: NOTIFICATIONS */}
        <div className="bg-surface border border-ink-hairline-1 rounded-[20px] overflow-hidden">
          <p className="px-[18px] py-[11px] bg-ink-hairline-1/50 text-[10px] font-extrabold tracking-[0.14em] text-ink-muted">
            NOTIFICATIONS
          </p>
          <NotifRow title="Fourth Calls" why="a game near you needs one" on />
          <NotifRow title="Lineup locks" why="the Rotation picked, or benched, you" on />
          <NotifRow title="Tab nudges" why="one tap, once, lightly funny" on />
          <div className="px-[18px] py-3">
            <Meta as="p">
              You&apos;re getting all of these. Per-type controls arrive with the notifications update.
            </Meta>
          </div>
        </div>
      </div>

      {showCamera && (
        <SelfieCamera
          onClose={() => setShowCamera(false)}
          onSaved={(url) => {
            setAvatar(url);
            setShowCamera(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function NotifRow({ title, why, on }: { title: string; why: string; on: boolean }) {
  return (
    <div className="flex items-center gap-3 px-[18px] py-[13px] border-b border-ink-hairline-1 last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-bold text-ink">{title}</p>
        <Meta as="p" className="mt-0.5">{why}</Meta>
      </div>
      <SettingToggle on={on} />
    </div>
  );
}
