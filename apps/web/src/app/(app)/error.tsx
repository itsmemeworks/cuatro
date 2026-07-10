"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";
import { errorCopy } from "@/lib/error-copy";

/**
 * Warm error boundary for the (app) route group — replaces Next's default
 * (unbranded) crash page when a server component throws. Copy comes through
 * errorCopy() so the voice stays consistent, and the raw error / digest is
 * NEVER shown to the user (repo rule 9). One quiet retry, no coral: a crash
 * screen isn't the place for the screen's one coral action.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surfaced to Sentry via the global instrumentation; log here too so a
    // local crash isn't silent in the dev console.
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-dvh px-6 flex flex-col items-center justify-center text-center gap-3">
      <p className="text-cu-card-title text-ink">That didn&apos;t load</p>
      <p className="text-cu-body text-ink-muted max-w-xs">{errorCopy(null)}</p>
      <Button variant="quiet" onClick={reset} className="mt-2">
        Try again
      </Button>
    </main>
  );
}
