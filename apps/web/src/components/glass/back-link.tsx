"use client";

import { useRouter } from "next/navigation";

/**
 * A "‹ Back" affordance for a public player profile — reached by tapping a
 * name from a members list or a result, so browser-style back is the right
 * mental model. Styled like the Ledger's back link (text-action, mono-ish
 * secondary). Client-only because it drives router.back().
 */
export function BackLink({ label = "Back" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="self-start text-cu-secondary font-bold text-action"
    >
      ‹ {label}
    </button>
  );
}
