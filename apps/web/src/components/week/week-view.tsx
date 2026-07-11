import Link from "next/link";
import type { WeekData } from "@/server/week";
import { WeekGrid } from "./week-grid";
import { WeekEmpty } from "./week-empty";
import { NeedsAnswerPanel } from "./needs-answer-panel";
import { FourthCallSideCard } from "./fourth-call-side-card";
import { TabSettleCard } from "./tab-settle-card";

type Viewer = { userId: string; displayName: string; avatarUrl: string | null };

/**
 * The wide (≥900px) "Your week" surface — the 7-day cross-Circle diary the
 * desktop app exists for (design "Desktop · Your week"). Renders from ONE read
 * of getWeekData: the grid, the needs-answer panel, the incoming Fourth Call
 * card, and the Tab settle prompt. The shell already provides identity + bell,
 * so this has no header avatar/bell of its own — just the title and the one
 * quiet "Log last night's result" action. Circle-less viewers get the
 * first-run empty layout instead.
 */
export function WeekView({ data, viewer }: { data: WeekData; viewer: Viewer }) {
  if (data.hasNoCircles) return <WeekEmpty data={data} />;

  const subtitle = [
    "across your Circles",
    `${data.gameCount} game${data.gameCount === 1 ? "" : "s"}`,
    data.needsAnswerCount > 0 ? `${data.needsAnswerCount} need${data.needsAnswerCount === 1 ? "s" : ""} an answer` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hasSideCards = data.needsAnswer || data.fourthCall || data.tabPrompt;

  return (
    <div>
      <div className="flex items-end gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-[29px] leading-none font-extrabold tracking-[-0.01em] text-ink">Your week</h1>
          <p className="text-[12.5px] text-ink-muted mt-1.5">{subtitle}</p>
        </div>
        {data.logResultSessionId && (
          <Link
            href={`/matches/new?session=${data.logResultSessionId}`}
            className="rounded-[13px] bg-strong-bg text-strong-fg px-5 py-3 text-[13px] font-extrabold whitespace-nowrap transition-cu-state hover:opacity-90"
          >
            Log last night&apos;s result
          </Link>
        )}
      </div>

      <div className="mt-5">
        <WeekGrid data={data} />
      </div>

      {hasSideCards && (
        <div className="mt-4 grid grid-cols-[1.25fr_1fr] gap-4 items-start">
          {data.needsAnswer && (
            <NeedsAnswerPanel
              session={{
                sessionId: data.needsAnswer.sessionId,
                circleName: data.needsAnswer.circleName,
                venueName: data.needsAnswer.venueName,
                startsAt: data.needsAnswer.startsAt,
                timezone: data.needsAnswer.timezone,
                slots: data.needsAnswer.slots,
                confirmed: data.needsAnswer.confirmed,
              }}
              viewer={viewer}
            />
          )}
          {(data.fourthCall || data.tabPrompt) && (
            <div className="flex flex-col gap-3">
              {data.fourthCall && <FourthCallSideCard card={data.fourthCall} />}
              {data.tabPrompt && <TabSettleCard prompt={data.tabPrompt} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
