import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { looksLikeId } from "@/lib/looks-like-id";
import { LinkFallbackShell } from "@/components/entry/link-fallback";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Legacy sealed-result link (/r/:uuid). Never a privileged lookup — a
 * valid-looking id always gets this generic landing, never the real result.
 */
export default async function LegacyResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();

  return (
    <LinkFallbackShell
      heading="A sealed Cuatro result was shared with you"
      body="Who played, who won, what it did to their Glass. See it inside the app."
    />
  );
}
