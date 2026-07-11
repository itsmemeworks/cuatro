import Link from "next/link";
import { Chip, Fact, Meta } from "@/components/ui";
import { TabOweRow, type TabOweRowData } from "./tab-owe-row";
import { formatMoneyWholeSigned } from "./money";

/** One Circle's card on the wide Tab: its flag, the viewer's net inside it, and their active balance rows. */
export interface TabCircleCard {
  id: string;
  name: string;
  /** emblem when set, else two-letter initials — same fallback the shell rail uses. */
  flagLabel: string;
  flagColor: string;
  /** The viewer's net inside this Circle (chosen currency, GBP-first), null when all square. */
  netMinor: number | null;
  netCurrency: string | null;
  /** The viewer's currently-open balances in this Circle (rendered as owe-rows), newest first. */
  oweRows: TabOweRowData[];
  /** Member avatar URLs by userId, for the owe-rows' counterparty photos (initials fallback when absent). */
  avatarByUserId: Record<string, string | null>;
}

/** The chosen-currency net across all the viewer's Circles, or null when everything squares to zero. */
export interface TabGlobalNet {
  minor: number;
  currency: string;
}

/** Circle flag tile (initials/emblem on the Circle's colour) — markers render white on the colour, never coral (design/lib/design.ts). */
function Flag({ label, color }: { label: string; color: string }) {
  return (
    <div
      className="w-7 h-7 rounded-[9px] flex-none flex items-center justify-center text-[10px] font-extrabold text-white"
      style={{ backgroundColor: color }}
    >
      {label}
    </div>
  );
}

function CircleCard({ card, viewerUserId }: { card: TabCircleCard; viewerUserId: string }) {
  const square = card.netMinor == null || card.netMinor === 0;
  return (
    <div className="bg-surface border border-ink-hairline-1 rounded-[20px] overflow-hidden">
      <Link
        href={`/circles/${card.id}/tab`}
        className="flex items-center gap-2.5 px-[18px] py-[13px] bg-ink-hairline-1/50 hover:bg-ink-hairline-2 transition-cu-state"
      >
        <Flag label={card.flagLabel} color={card.flagColor} />
        <span className="flex-1 min-w-0 text-[13px] font-extrabold text-ink truncate">{card.name}</span>
        {square ? (
          <Chip tone="positive">All square ✓</Chip>
        ) : (
          <>
            <Fact size="sm" weight="bold" tone={card.netMinor! < 0 ? "loss" : "win"}>
              {formatMoneyWholeSigned(card.netMinor!, card.netCurrency!)}
            </Fact>
            <span className="text-[12px] font-bold text-action">→</span>
          </>
        )}
      </Link>
      {card.oweRows.length > 0 ? (
        <div>
          {card.oweRows.map((r) => (
            <TabOweRow
              key={r.id}
              entry={r}
              viewerUserId={viewerUserId}
              counterpartyAvatarUrl={card.avatarByUserId[r.payerUserId === viewerUserId ? r.debtorUserId : r.payerUserId]}
            />
          ))}
        </div>
      ) : (
        <p className="px-[18px] py-[13px] font-mono text-[11px] text-ink-muted">
          nothing owed. The Tab is here when someone fronts the balls
        </p>
      )}
    </div>
  );
}

/**
 * The wide home-context Tab (design/CUATRO-Web-LATEST.dc.html "The Tab (all
 * Circles)"): net-position header, one card per Circle with the viewer's
 * balance rows and Settle/Nudge, the nudge explainer, and the fee-free footer.
 * Read-only assembly over server/tab.ts's getTabView per Circle (the page does
 * the fetching); the Tab never charges a fee, it just keeps score.
 */
export function TabAllCircles({
  viewerUserId,
  globalNet,
  cards,
}: {
  viewerUserId: string;
  globalNet: TabGlobalNet | null;
  cards: TabCircleCard[];
}) {
  const anyActivity = cards.some((c) => c.oweRows.length > 0) || globalNet != null;

  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[29px] leading-none font-extrabold text-ink">The Tab</h1>
          <p className="mt-1.5 text-[12.5px] text-ink-muted">across all your Circles</p>
        </div>
        <div className="text-right">
          {globalNet == null ? (
            <Fact size="lg" weight="bold" className="text-[26px] leading-none">
              All square ✓
            </Fact>
          ) : (
            <>
              <Fact as="p" size="lg" weight="bold" tone={globalNet.minor < 0 ? "loss" : "win"} className="text-[26px] leading-none">
                {formatMoneyWholeSigned(globalNet.minor, globalNet.currency)}
              </Fact>
              <Meta as="p" className="mt-1">
                {globalNet.minor < 0 ? "you're down, overall" : "you're owed, overall"}
              </Meta>
            </>
          )}
        </div>
      </div>

      {!anyActivity ? (
        <div className="mt-[18px] bg-surface border border-ink-hairline-1 rounded-[20px] px-[18px] py-8 text-center">
          <p className="text-[13px] font-extrabold text-ink">Nothing owed, anywhere</p>
          <Meta as="p" className="mt-1.5">
            The Tab stays quiet until someone fronts a court or a tin of balls. No fees, no chasing, no spreadsheets.
          </Meta>
        </div>
      ) : (
        <div className="mt-[18px] grid grid-cols-1 min-[1180px]:grid-cols-2 gap-4 items-start">
          {cards.map((card) => (
            <CircleCard key={card.id} card={card} viewerUserId={viewerUserId} />
          ))}
          <div className="min-[1180px]:col-span-2 flex flex-col gap-3">
            <div className="rounded-[14px] bg-streak-tint px-4 py-[13px]">
              <p className="text-[12.5px] leading-[1.55] text-ink">
                Nudges are one tap, once: <em>&ldquo;Oi. £8 for Tuesday&apos;s court 🎾&rdquo;</em>. No interest, no drama, no red exclamation marks.
              </p>
            </div>
            <p className="text-center font-mono text-[10px] text-ink-muted">the Tab never charges fees. It just keeps score</p>
          </div>
        </div>
      )}
    </div>
  );
}
