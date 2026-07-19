import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { looksLikeId } from "@/lib/looks-like-id";
import { LinkFallbackShell } from "@/components/entry/link-fallback";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Legacy shared-game link (/g/:uuid) from before the native app. Never a
 * privileged lookup — a valid-looking id always gets this generic landing,
 * never real game data; a malformed id gets the designed 404.
 */
export default async function LegacyGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();

  return (
    <LinkFallbackShell
      heading="A Cuatro game was shared with you"
      body="Who's playing, the seats still open, all of it lives inside the app now."
    />
  );
}
