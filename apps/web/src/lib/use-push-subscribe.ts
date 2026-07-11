"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The ONE web-push enrolment flow, shared by the profile PushToggle and the
 * notification tray's quiet enable row: browser permission → server VAPID
 * key (GET /api/push/subscribe) → pushManager.subscribe → POST the
 * subscription so lib/push.ts persists it in push_subscriptions. Keep this
 * the single implementation — two drifting copies of a permission flow is
 * how you end up double-prompting people.
 *
 * Support detection doubles as the capability check everywhere: no service
 * worker or PushManager (e.g. an uninstalled iOS Safari tab) means the UI
 * offering push simply never renders.
 */

export type PushEnableResult = "subscribed" | "denied" | "unavailable" | "failed";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// The server's VAPID public key, fetched once per tab. `undefined` = not yet
// asked; `null` = asked and the server has no key configured (hide any push
// UI, never stub it). A transient fetch failure is NOT cached so a flaky
// request can't pin "no key" for the tab's life.
let cachedKey: string | null | undefined;

export async function fetchVapidPublicKey(): Promise<string | null> {
  if (cachedKey !== undefined) return cachedKey;
  try {
    const res = await fetch("/api/push/subscribe");
    if (!res.ok) return null;
    const { publicKey } = (await res.json()) as { publicKey: string | null };
    cachedKey = publicKey || null;
    return cachedKey;
  } catch {
    return null;
  }
}

/**
 * Where the tray's quiet enable row sits, given everything knowable about
 * this device. Pure so the never-ask-twice matrix is unit-testable:
 * the row OFFERS only when the browser can do push, the server has a key,
 * the device isn't already subscribed, permission isn't denied, and the
 * player hasn't already said "not now" (dismissal persists per device).
 */
export function trayPushRowState(input: {
  supported: boolean;
  permission: NotificationPermission | null;
  subscribed: boolean;
  dismissed: boolean;
  serverKey: string | null;
}): "offer" | "hidden" {
  if (!input.supported) return "hidden";
  if (input.dismissed) return "hidden";
  if (input.permission === "denied") return "hidden";
  if (input.subscribed) return "hidden";
  if (!input.serverKey) return "hidden";
  return "offer";
}

export function usePushSubscribe(): {
  supported: boolean;
  subscribed: boolean;
  enable: () => Promise<PushEnableResult>;
  disable: () => Promise<boolean>;
} {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    setSupported(true);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {});
  }, []);

  const enable = useCallback(async (): Promise<PushEnableResult> => {
    try {
      const reg = await navigator.serviceWorker.ready;
      // Permission first (matches the original PushToggle flow): if this
      // device is already granted, requestPermission resolves silently.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return "denied";
      const publicKey = await fetchVapidPublicKey();
      if (!publicKey) return "unavailable";
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
        // Don't leave a browser-side subscription the server never learned
        // about: it would silently receive nothing forever.
        await sub.unsubscribe();
        return "failed";
      }
      setSubscribed(true);
      return "subscribed";
    } catch {
      return "failed";
    }
  }, []);

  const disable = useCallback(async (): Promise<boolean> => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      return true;
    } catch {
      return false;
    }
  }, []);

  return { supported, subscribed, enable, disable };
}

/** VAPID keys travel base64url; PushManager wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
