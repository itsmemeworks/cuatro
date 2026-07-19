import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { looksLikeId } from "@/lib/looks-like-id";
import { LinkFallbackShell } from "@/components/entry/link-fallback";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Legacy shared-player link (/p/:uuid). Never a privileged lookup — a
 * valid-looking id always gets this generic landing, never a real profile.
 */
export default async function LegacyPlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();

  return (
    <LinkFallbackShell
      heading="Someone shared their Cuatro profile with you"
      body="Their Glass, their Ledger, their four. See it inside the app."
    />
  );
}
