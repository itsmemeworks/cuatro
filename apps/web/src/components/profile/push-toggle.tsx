"use client";

import { useEffect, useState } from "react";
import { Card, Meta } from "@/components/ui";
import { Toggle } from "@/components/ui/toggle";

/**
 * The one place a player switches web push on or off. Requests browser
 * permission, subscribes this device via the service worker, and stores the
 * subscription server-side (lib/push.ts persists it in push_subscriptions,
 * so it survives deploys and one player can have several devices).
 *
 * Renders nothing when the browser can't do push (no service worker or
 * PushManager, e.g. an uninstalled iOS Safari tab) — the row appearing IS
 * the capability check. iOS shows it only once CUATRO is installed to the
 * home screen, which is exactly the story the pilot needs.
 */
export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    setSupported(true);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(Boolean(sub)))
      .catch(() => {});
  }, []);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const reg = await navigator.serviceWorker.ready;
      if (enabled) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setEnabled(false);
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setFailed(true);
          return;
        }
        const keyRes = await fetch("/api/push/subscribe");
        const { publicKey } = (await keyRes.json()) as { publicKey: string | null };
        if (!publicKey) {
          setFailed(true);
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        if (!res.ok) {
          await sub.unsubscribe();
          setFailed(true);
          return;
        }
        setEnabled(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-cu-body text-ink">Notifications on this device</p>
          <Meta as="p" className="mt-0.5">fourth calls, results to confirm, your four being set</Meta>
        </div>
        <Toggle checked={enabled} onToggle={toggle} label="Notifications on this device" disabled={busy} />
      </div>
      {failed && (
        <Meta as="p" tone="loss">
          Couldn&apos;t switch that on. Check notification permissions for CUATRO in your browser settings, then try again.
        </Meta>
      )}
    </Card>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
