"use client";

import { useState } from "react";
import { Button, Card, Meta, Sheet } from "@/components/ui";
import { updateDisplayNameAction } from "@/lib/actions";

/**
 * Display-name edit + logout, demoted from an always-open form on the
 * Profile screen to a quiet "Settings" row + sheet (design/DESIGN-AUDIT.md
 * P4) — the prototype's Profile has no visible settings surface at all;
 * this is the least intrusive place for the two actions the app still
 * needs somewhere.
 */
export function SettingsSheet({ displayName, email }: { displayName: string | null; email: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-cu-secondary font-semibold text-ink-muted text-center py-2"
      >
        Settings
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Settings">
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <form action={updateDisplayNameAction} className="flex flex-col gap-3">
              <label htmlFor="displayName" className="text-cu-secondary font-semibold text-ink-muted">
                Display name
              </label>
              <input
                id="displayName"
                name="displayName"
                defaultValue={displayName ?? ""}
                placeholder="What should your Circles call you?"
                className="w-full rounded-button px-4 py-3 text-cu-body outline-none bg-ground border border-ink-hairline-2 text-ink"
                style={{ minHeight: "var(--touch-target)" }}
              />
              <Button type="submit" variant="strong" size="lg" fullWidth>
                Save
              </Button>
            </form>
            <Meta>{email}</Meta>
          </Card>

          <form action="/api/auth/logout" method="POST">
            <Button type="submit" variant="quiet" size="lg" fullWidth>
              Log out
            </Button>
          </form>
        </div>
      </Sheet>
    </>
  );
}
