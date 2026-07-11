"use client";

import { useState } from "react";
import { Card, Meta } from "@/components/ui";
import { Toggle } from "@/components/ui/toggle";
import { usePushSubscribe } from "@/lib/use-push-subscribe";

/**
 * The profile's switch for web push on this device. The actual enrolment
 * flow (permission → server key → subscribe → persist in
 * push_subscriptions) lives in lib/use-push-subscribe.ts, shared with the
 * notification tray's quiet enable row — one implementation, two surfaces.
 *
 * Renders nothing when the browser can't do push (no service worker or
 * PushManager, e.g. an uninstalled iOS Safari tab) — the row appearing IS
 * the capability check. iOS shows it only once CUATRO is installed to the
 * home screen, which is exactly the story the pilot needs.
 */
export function PushToggle() {
  const { supported, subscribed, enable, disable } = usePushSubscribe();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    if (subscribed) {
      const ok = await disable();
      if (!ok) setFailed(true);
    } else {
      const result = await enable();
      if (result !== "subscribed") setFailed(true);
    }
    setBusy(false);
  }

  if (!supported) return null;

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-cu-body text-ink">Notifications on this device</p>
          <Meta as="p" className="mt-0.5">fourth calls, results to confirm, your four being set</Meta>
        </div>
        <Toggle checked={subscribed} onToggle={toggle} label="Notifications on this device" disabled={busy} />
      </div>
      {failed && (
        <Meta as="p" tone="loss">
          Couldn&apos;t switch that on. Check notification permissions for CUATRO in your browser settings, then try again.
        </Meta>
      )}
    </Card>
  );
}
