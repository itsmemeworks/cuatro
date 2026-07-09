import Link from "next/link";
import { Card, InfoTerm } from "@/components/ui";
import { BoardCard, type BoardCardProps } from "./board-card";

/**
 * The "Near you" Board section on Home. Header carries the first (and only)
 * <InfoTerm term="board"> on this surface. Three states, never a dead end:
 *  - no patch  → a quiet pointer to set a home venue (discovery isn't active
 *                until a patch resolves — see server/patch.ts);
 *  - empty     → a quiet "nothing near you this week";
 *  - games     → the list of BoardCards.
 * No coral anywhere here — Home's coral belongs to the NeedsAnswerCard /
 * create-circle CTA; the ask action inside each card is `strong`.
 */
export function BoardSection({ hasPatch, games }: { hasPatch: boolean; games: BoardCardProps[] }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-cu-secondary font-bold text-ink-muted">
          <InfoTerm term="board" label="Near you" />
        </h2>
      </div>

      {!hasPatch ? (
        <Card className="flex flex-col gap-1">
          <p className="text-cu-card-title">Games near you</p>
          <p className="text-cu-body text-ink-muted">
            Set your home venue to see open games near you.{" "}
            <Link href="/profile" className="font-bold text-ink underline decoration-ink-hairline-4 underline-offset-2">
              Open settings
            </Link>
          </p>
        </Card>
      ) : games.length === 0 ? (
        <Card>
          <p className="text-cu-body text-ink-muted">No open games near you this week — check back soon.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {games.map((game) => (
            <BoardCard key={game.sessionId} {...game} />
          ))}
        </div>
      )}
    </section>
  );
}
