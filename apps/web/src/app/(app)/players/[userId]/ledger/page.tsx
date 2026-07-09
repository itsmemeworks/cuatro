import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getPlayerLedger } from "@/server/players";
import { LedgerView } from "@/components/glass/ledger-view";

/**
 * A player's full public Ledger — the same radically-transparent, append-only
 * record the owner sees on /profile/ledger, for anyone. Own id redirects to
 * the canonical /profile/ledger; a guest (no Ledger) redirects to their
 * presence page rather than erroring; unknown id is the app 404.
 */
export default async function PlayerLedgerPage({ params }: { params: Promise<{ userId: string }> }) {
  const viewer = await getSessionUser();
  if (!viewer) return null;

  const { userId } = await params;
  if (userId === viewer.id) redirect("/profile/ledger");

  const ledger = await getPlayerLedger(userId);
  if (!ledger) notFound();
  if (ledger.user.isGuest) redirect(`/players/${userId}`);

  const firstName = ledger.user.displayName.split(" ")[0] || ledger.user.displayName;

  return (
    <LedgerView
      glass={ledger.glass}
      rows={ledger.rows}
      backHref={`/players/${userId}`}
      backLabel={firstName}
      subtitle={`nothing hidden, every move of ${firstName}'s Glass explained, not just a number that went up or down`}
      emptyCopy={`No verified matches yet. ${firstName}'s Ledger fills in the moment their first result is confirmed by both teams.`}
    />
  );
}
