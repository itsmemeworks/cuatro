import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { looksLikeId } from "@/lib/looks-like-id";
import { LinkFallbackShell } from "@/components/entry/link-fallback";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Legacy shared-Circle link (/c/:uuid). Never a privileged lookup — a
 * valid-looking id always gets this generic landing, never real Circle
 * data. Current Circle invites use /join/[code]; this only serves old links.
 */
export default async function LegacyCirclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!looksLikeId(id)) notFound();

  return (
    <LinkFallbackShell
      heading="A Cuatro Circle was shared with you"
      body="Its games, its chat, its Standing Game. See what it is inside the app."
    />
  );
}
