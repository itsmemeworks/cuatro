/**
 * THE HEARTBEAT — an in-process interval that fires CUATRO's time-based
 * domain logic without waiting for someone to open the app.
 *
 * The prod machine runs always-warm (fly.toml: min 1, autostop off), so a
 * plain setInterval in the Node.js server process is enough — no external cron,
 * no queue. Before this existed, three things only ever happened lazily "on
 * view": (1) the next session for a Standing Game was materialised when its
 * page was opened, so if nobody looked, its RSVP window never opened and it
 * never appeared on anyone's board; (2) the T-48h Fourth Call for a short game;
 * (3) THE ROTATION's cutoff lock and its sit-out offer advance. A session
 * nobody happened to view between T-48h and kickoff silently missed all of it.
 *
 * This module does NOT re-implement any of those rules. It calls the exact
 * same exported functions the on-view code paths call
 * (ensureUpcomingSessionForStandingGame, lockRotationIfDue,
 * offerRotationSlotIfNeeded, checkFourthCallLevel1 — mirroring
 * app/api/games/sessions/[id]/route.ts's on-view maintenance sequence). Every
 * one of those is idempotent (materialisation is a pure function of the
 * schedule; Fourth Call dedupes on an existing notification; the rotation lock
 * dedupes on rotationLockedAt), so running them on a 60s tick never nags twice
 * or double-writes.
 *
 * Deliberately NOT auto-run here: the played-with and Local Ring Fourth Call
 * escalations (checkFourthCallPlayedWith / checkFourthCallLocalRing). Those
 * reach beyond the circle (people you've played with, then nearby strangers),
 * and today they auto-open only once an organiser has opened the Fourth Call
 * send screen — an intent signal. Escalating to strangers purely on a
 * background timer is a product decision; left to the organiser-initiated path
 * until Pete rules on it (noted in the wave manifest).
 */
import { and, eq, gt, lt } from "drizzle-orm";
import { sessions, standingGames } from "@cuatro/db";
import { getDb } from "./db";
import {
  checkFourthCallLevel1,
  ensureUpcomingSessionForStandingGame,
  lockRotationIfDue,
  offerRotationSlotIfNeeded,
} from "./games-service";

/** How often the heartbeat fires. 60s is comfortably finer than any window it services (the coarsest is the 20-minute Fourth Call grace). */
export const TICK_INTERVAL_MS = 60_000;

/**
 * Only sessions starting within this window get per-session maintenance each
 * tick. Comfortably covers the 48h Fourth Call window, the default 24h rotation
 * cutoff, and the max 21-day RSVP window — a session further out has nothing
 * due yet, and this keeps the per-tick scan bounded. (At pilot scale the table
 * is tiny; the sessions_starts_at_idx index keeps this cheap at league scale.)
 */
export const MAINTENANCE_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;

export interface TickSummary {
  materialisedStandingGames: number;
  sessionsChecked: number;
  errors: number;
}

type ErrorReporter = (err: unknown, context: string) => void;

// Default reporter logs; instrumentation.ts swaps in Sentry.captureException at
// startup (see setSchedulerErrorReporter). Kept injectable so scheduler.ts pulls
// no Next/Sentry code into the unit test graph.
let reportError: ErrorReporter = (err, context) => {
  console.error(`[scheduler] ${context}`, err);
};

export function setSchedulerErrorReporter(fn: ErrorReporter): void {
  reportError = fn;
}

/**
 * One pass of the heartbeat. Safe to call directly (tests do). Each unit of
 * work is isolated in its own try/catch so one bad session can't abort the
 * whole sweep, and `now` is threaded through so tests can pin the clock.
 */
export async function runSchedulerTick(now: Date = new Date()): Promise<TickSummary> {
  const { db } = await getDb();
  const summary: TickSummary = { materialisedStandingGames: 0, sessionsChecked: 0, errors: 0 };

  // 1. Materialise the next session for every active Standing Game so its RSVP
  //    window opens on schedule (idempotent — recomputes the same occurrence
  //    and finds the existing row).
  const active = await db
    .select({ id: standingGames.id })
    .from(standingGames)
    .where(eq(standingGames.active, true));
  for (const sg of active) {
    try {
      await ensureUpcomingSessionForStandingGame(db, sg.id, now);
      summary.materialisedStandingGames++;
    } catch (err) {
      summary.errors++;
      reportError(err, `ensureUpcomingSessionForStandingGame(${sg.id})`);
    }
  }

  // 2. Run the on-view maintenance sequence for every soon-enough upcoming
  //    session (same order as the session-detail route: rotation lock, then the
  //    sit-out offer, then ring-1 Fourth Call only once the offer is exhausted
  //    or not applicable).
  const horizon = now.getTime() + MAINTENANCE_HORIZON_MS;
  const upcoming = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.status, "upcoming"),
        gt(sessions.startsAt, now.getTime()),
        lt(sessions.startsAt, horizon),
      ),
    );
  for (const s of upcoming) {
    try {
      await lockRotationIfDue(db, s.id, now);
      const offer = await offerRotationSlotIfNeeded(db, s.id, now);
      if (offer.state === "exhausted" || offer.state === "not_applicable") {
        await checkFourthCallLevel1(db, s.id, now);
      }
      summary.sessionsChecked++;
    } catch (err) {
      summary.errors++;
      reportError(err, `session maintenance (${s.id})`);
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Lifecycle — started once from instrumentation.ts (nodejs runtime only).
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
// Serialize ticks: if a slow tick is still in flight when the next interval
// fires, skip it rather than overlap two sweeps against the same rows.
let inFlight = false;

/** True under vitest/tests — the heartbeat must never start during a test run. */
function isTestEnv(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
}

/**
 * Start the heartbeat. Idempotent (a second call is a no-op) and inert under
 * tests. Call exactly once, from instrumentation.ts's register() in the
 * Node.js runtime.
 */
export function startScheduler(): void {
  if (timer || isTestEnv()) return;
  timer = setInterval(() => {
    void tickOnce();
  }, TICK_INTERVAL_MS);
  // Don't let the interval keep the process alive on its own.
  if (typeof timer.unref === "function") timer.unref();
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function tickOnce(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    await runSchedulerTick();
  } catch (err) {
    // runSchedulerTick already isolates per-item errors; this catches a failure
    // of the sweep itself (e.g. the initial getDb()).
    reportError(err, "runSchedulerTick");
  } finally {
    inFlight = false;
  }
}
