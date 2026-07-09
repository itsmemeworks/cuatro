import { getSessionUser } from "@/lib/session";
import { getPlayerLedger } from "@/server/players";
import { LedgerView } from "@/components/glass/ledger-view";

export default async function LedgerPage() {
  const user = await getSessionUser();
  if (!user) return null;

  const ledger = await getPlayerLedger(user.id);
  if (!ledger) return null;

  return (
    <LedgerView
      glass={ledger.glass}
      rows={ledger.rows}
      backHref="/profile"
      backLabel="Profile"
      subtitle="nothing hidden, every move explained, not just a number that went up or down"
      emptyCopy="No verified matches yet. Your Glass is waiting patiently, like a lob hanging at the back. The Ledger fills in the moment your first result is confirmed by both teams."
    />
  );
}
