"use client";

import { useState } from "react";
import { Button, Meta } from "@/components/ui";
import { saveNameAction } from "@/app/welcome/name/actions";

/**
 * The one-field first-run name step (F6). Prefilled with the guess derived
 * from the email local-part; the user can correct it or skip. Both actions
 * submit the same server action (saveNameAction) — Continue with the typed
 * name, Skip with intent=skip — so either way we record that the step's been
 * seen and continue to `next`. One coral action per screen: Continue.
 */
export function NameCaptureForm({ guess, next }: { guess: string; next: string }) {
  const [name, setName] = useState(guess);

  return (
    <main className="min-h-dvh flex flex-col justify-center px-7 py-12 bg-ground text-ink">
      <h1 className="text-cu-title">What should your Circles call you?</h1>
      <Meta as="p" className="mt-2.5 leading-[1.6]">
        this is the name your four sees on games, results and the feed — you can change it later in
        Settings
      </Meta>

      <form action={saveNameAction} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="displayName" className="sr-only">
          Your name
        </label>
        <input
          id="displayName"
          name="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="First name — e.g. Alex"
          autoFocus
          autoComplete="name"
          className="w-full box-border rounded-button px-4 py-3.5 text-[15px] font-semibold outline-none bg-surface border border-ink-hairline-3 text-ink"
        />
        <Button type="submit" name="intent" value="save" variant="primary" size="lg" fullWidth>
          Continue
        </Button>
        <Button
          type="submit"
          name="intent"
          value="skip"
          formNoValidate
          variant="quiet"
          size="lg"
          fullWidth
        >
          Skip for now
        </Button>
      </form>
    </main>
  );
}
