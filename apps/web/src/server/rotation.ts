/**
 * THE ROTATION — the fair-share selection at the heart of the feature.
 *
 * When a Standing Game has rotation on, members declare availability rather
 * than grabbing slots, and CUATRO picks who plays. This module is that pick:
 * a PURE, deterministic function (no DB, no clock) so the "why" is testable
 * and always explainable. The service layer (games-service.ts) gathers the
 * inputs — who's available and this game's recent play history — and this
 * decides who's in, who sits out (in the order they'd auto-promote), and the
 * reason to show each player.
 *
 * Fairness rule, in priority order (whoever most deserves to PLAY sorts first):
 *   1. fewest plays in the recent window   — you've sat out, you're overdue
 *   2. sat out most recently                — of two equally-rested players,
 *                                             the one benched last week is due
 *   3. earliest availability reply          — first to say "I'm in" this week
 *   4. userId                               — a stable final tie-break so the
 *                                             result is fully deterministic
 *
 * There is no country, no clock, and no randomness in here by construction —
 * same inputs always give the same four, which is what lets the UI promise
 * "it's never an argument".
 */

/** How many of the most recent past sessions count toward "recent plays". */
export const ROTATION_RECENT_WINDOW = 4;

export interface RotationCandidate {
  userId: string;
  /**
   * Order this player declared availability, ascending (0 = first to reply).
   * Used only as a tie-break after fairness, so an early "I'm available" is a
   * gentle nudge, never a slot-grab.
   */
  availabilityOrder: number;
}

/** One past session of this Standing Game and who actually played in it. */
export interface RotationPastSession {
  /** Epoch ms of the session's start — only its ordering matters here. */
  startsAt: number;
  /** The players who took the court (verified match roster, else who was 'in'). */
  playedUserIds: string[];
}

export interface RotationReason {
  /** Plays inside the recent window. */
  plays: number;
  /** How many past sessions the window actually spans (< ROTATION_RECENT_WINDOW early on). */
  windowSize: number;
  /** Did this player sit out the single most recent past session? Drives "you're due" copy. */
  satOutLast: boolean;
  /** Ready-to-render mono line, e.g. "played 2 of last 4". */
  reason: string;
}

export interface RotationSelection {
  /** The players chosen to play, best-deserving first (length ≤ slots). */
  inUserIds: string[];
  /** Everyone available but not selected, in the order they'd auto-promote if someone drops. */
  sittingUserIds: string[];
  /** Per-player explainer, keyed by userId, for every candidate. */
  reasons: Record<string, RotationReason>;
  /**
   * True when this Standing Game has NO played history yet: rotation can't be
   * fair without a record to be fair about, so selection is pure arrival order
   * (first to declare availability), exactly the old first-come behaviour. The
   * UI must be honest about this — reasons read "first to tap in", never a fake
   * "played 0 of last 0". Flips to false the moment one session has been played.
   */
  coldStart: boolean;
}

interface Scored {
  userId: string;
  availabilityOrder: number;
  plays: number;
  windowSize: number;
  satOutLast: boolean;
  /** Epoch ms of the most recent window session this player sat out; -Infinity if they sat out none. */
  mostRecentSitOutAt: number;
}

/**
 * Decide the rotation for one session. Deterministic and pure — see the file
 * header for the fairness rule. `slots` is the game's slot count (usually 4);
 * with fewer available than slots, everyone available is in and `sittingUserIds`
 * is empty (the Fourth Call fills the rest, per the brief).
 */
export function computeRotation(
  candidates: RotationCandidate[],
  pastSessions: RotationPastSession[],
  slots: number,
  windowSize: number = ROTATION_RECENT_WINDOW,
): RotationSelection {
  // Most-recent-first, then keep only the window. Copy before sorting so we
  // never mutate the caller's array.
  const window = [...pastSessions].sort((a, b) => b.startsAt - a.startsAt).slice(0, windowSize);
  const windowCount = window.length;
  const mostRecent = window[0] ?? null;

  const scored: Scored[] = candidates.map((c) => {
    let plays = 0;
    let mostRecentSitOutAt = -Infinity;
    for (const s of window) {
      if (s.playedUserIds.includes(c.userId)) {
        plays++;
      } else if (s.startsAt > mostRecentSitOutAt) {
        mostRecentSitOutAt = s.startsAt;
      }
    }
    const satOutLast = !!mostRecent && !mostRecent.playedUserIds.includes(c.userId);
    return {
      userId: c.userId,
      availabilityOrder: c.availabilityOrder,
      plays,
      windowSize: windowCount,
      satOutLast,
      mostRecentSitOutAt,
    };
  });

  scored.sort(
    (a, b) =>
      a.plays - b.plays ||
      b.mostRecentSitOutAt - a.mostRecentSitOutAt ||
      a.availabilityOrder - b.availabilityOrder ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );

  const coldStart = windowCount === 0;
  const reasons: Record<string, RotationReason> = {};
  for (const s of scored) {
    reasons[s.userId] = {
      plays: s.plays,
      windowSize: s.windowSize,
      satOutLast: s.satOutLast,
      // Cold start has no fairness story to tell, so say so honestly: the four
      // are simply whoever tapped in first, like the old first-come flow.
      reason: coldStart ? "first to tap in" : `played ${s.plays} of last ${windowCount}`,
    };
  }

  return {
    inUserIds: scored.slice(0, slots).map((s) => s.userId),
    sittingUserIds: scored.slice(slots).map((s) => s.userId),
    reasons,
    coldStart,
  };
}
