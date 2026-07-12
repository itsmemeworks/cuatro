import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circleMembers, circles, matches, notifications, ratingEvents, sessions, users, type CuatroDb, type GameType } from "@cuatro/db";
import { createTestClient } from "@cuatro/db";
import {
  AD_HOC_MAX_AGE_MS,
  createMatchesStoreFromClient,
  MatchAlreadyRecordedError,
  type MatchesStore,
} from "@/server/matches-db";

const HOUR_MS = 60 * 60 * 1000;

async function insertUser(db: CuatroDb, email: string, displayName: string) {
  const [row] = await db.insert(users).values({ email, displayName }).returning();
  return row;
}

async function insertCircle(db: CuatroDb, createdBy: string, defaultGameType: GameType = "competitive") {
  const [circle] = await db
    .insert(circles)
    .values({ name: "The Four", inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy, defaultGameType })
    .returning();
  return circle;
}

async function addMember(db: CuatroDb, circleId: string, userId: string) {
  await db.insert(circleMembers).values({ circleId, userId, role: "member" });
}

/** A circle with four members, ready for an ad-hoc record. */
async function fourInACircle(db: CuatroDb, defaultGameType: GameType = "competitive") {
  const alex = await insertUser(db, "alex@example.com", "Alex");
  const priya = await insertUser(db, "priya@example.com", "Priya");
  const jordan = await insertUser(db, "jordan@example.com", "Jordan");
  const kwame = await insertUser(db, "kwame@example.com", "Kwame");
  const circle = await insertCircle(db, alex.id, defaultGameType);
  for (const u of [alex, priya, jordan, kwame]) await addMember(db, circle.id, u.id);
  return { alex, priya, jordan, kwame, circle };
}

const SETS = [
  { a: 6, b: 3 },
  { a: 6, b: 4 },
];

describe("ad-hoc match: record without a session (issue #28)", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(async () => {
    store = createMatchesStoreFromClient(await createTestClient());
    db = store.db;
  });

  afterEach(async () => {
    await store.close();
  });

  it("mints a synthetic played session in the same transaction as the match, then the normal seal flow works downstream", async () => {
    const { alex, priya, jordan, kwame, circle } = await fourInACircle(db);
    const playedAt = Date.now() - 3 * HOUR_MS; // "earlier today"

    const { matchId, sessionId } = await store.recordAdHocMatch({
      circleId: circle.id,
      reporterId: alex.id,
      playedAt,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: SETS,
    });

    // The synthetic session: already played, dated when the game happened,
    // circle-anchored, no venue, no standing game.
    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(session).toBeDefined();
    expect(session!.status).toBe("played");
    expect(session!.startsAt).toBe(playedAt);
    expect(session!.circleId).toBe(circle.id);
    expect(session!.standingGameId).toBeNull();
    expect(session!.venueId).toBeNull();

    // The match hangs on it with the classification snapshotted.
    const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(match!.sessionId).toBe(sessionId);
    expect(match!.status).toBe("pending_confirmation");
    expect(match!.playedAt).toBe(playedAt);
    expect(match!.gameType).toBe("competitive");

    // "Confirm your result" went to the OTHER team only (reporter's team auto-confirmed).
    const notifs = await db.select().from(notifications);
    expect(notifs.filter((n) => n.type === "confirm_result").map((n) => n.userId).sort()).toEqual(
      [jordan.id, kwame.id].sort(),
    );

    // Opposing team confirms — seal semantics identical to a session match.
    const outcome = await store.confirmMatch(matchId, jordan.id);
    expect(outcome.status).toBe("verified");
    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    expect(events).toHaveLength(4);

    // The Ledger row renders with the synthetic session's context: W/L from
    // the match winner, and the match detail prose gets the circle + played-at.
    const ledger = await store.getLedger(alex.id);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.matchId).toBe(matchId);
    expect(ledger[0]!.won).toBe(true);

    const detail = await store.getMatchDetail(matchId, kwame.id);
    expect(detail!.context.circleName).toBe("The Four");
    expect(detail!.context.startsAt.getTime()).toBe(playedAt);
    expect(detail!.context.venueName).toBeNull();
    expect(detail!.viewerTeam).toBe("B");

    // Zero special-casing downstream: the synthetic session shows up in the
    // wide overlay's step-1 list as a logged game.
    const recordable = await store.getRecordableSessions(priya.id);
    const row = recordable.find((r) => r.sessionId === sessionId);
    expect(row).toBeDefined();
    expect(row!.match?.id).toBe(matchId);
    expect(row!.circleName).toBe("The Four");
  });

  it("inherits the circle's default game type (friendly circle -> friendly match, no rating events on seal)", async () => {
    const { alex, priya, jordan, kwame, circle } = await fourInACircle(db, "friendly");

    const { matchId, sessionId } = await store.recordAdHocMatch({
      circleId: circle.id,
      reporterId: alex.id,
      playedAt: Date.now(),
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: SETS,
    });

    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(session!.gameType).toBe("friendly");
    const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(match!.gameType).toBe("friendly");

    // FRIENDLIES gate: seals normally, writes NO rating events, moves nobody.
    const outcome = await store.confirmMatch(matchId, kwame.id);
    expect(outcome.status).toBe("verified");
    expect(await db.select().from(ratingEvents)).toHaveLength(0);
    const [alexAfter] = await db.select().from(users).where(eq(users.id, alex.id));
    expect(alexAfter!.verifiedMatchCount).toBe(0);
    expect(alexAfter!.rating).toBeNull();
  });

  it("an explicit game type at record time overrides the circle default (the design's 'Ad-hoc matches choose it here')", async () => {
    const { alex, priya, jordan, kwame, circle } = await fourInACircle(db, "friendly");

    const { matchId, sessionId } = await store.recordAdHocMatch({
      circleId: circle.id,
      reporterId: alex.id,
      playedAt: Date.now(),
      gameType: "competitive",
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: SETS,
    });

    const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(session!.gameType).toBe("competitive");
    const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(match!.gameType).toBe("competitive");

    await store.confirmMatch(matchId, jordan.id);
    expect(await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId))).toHaveLength(4);
  });

  it("mints named guests inside the recording transaction, per the normal rules", async () => {
    const { alex, priya, jordan, circle } = await fourInACircle(db);

    const { matchId } = await store.recordAdHocMatch({
      circleId: circle.id,
      reporterId: alex.id,
      playedAt: Date.now(),
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, "tok-guest"],
      sets: SETS,
      newGuests: [{ token: "tok-guest", name: "Sam" }],
    });

    const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
    const [guest] = await db.select().from(users).where(eq(users.id, match!.teamBPlayer2Id));
    expect(guest!.isGuest).toBe(true);
    expect(guest!.displayName).toBe("Sam");
    expect(guest!.email).toBeNull();

    // A real member on the guest's team can still seal it.
    const outcome = await store.confirmMatch(matchId, jordan.id);
    expect(outcome.status).toBe("verified");
  });

  it("is all-or-nothing: a failure inside the transaction leaves no synthetic session and no orphan guests", async () => {
    const { alex, priya, jordan, circle } = await fourInACircle(db);
    const usersBefore = (await db.select().from(users)).length;

    // teamB2 references a user that doesn't exist -> the match insert's FK
    // fails AFTER the session mint and the guest mint, so everything must roll back.
    await expect(
      store.recordAdHocMatch({
        circleId: circle.id,
        reporterId: alex.id,
        playedAt: Date.now(),
        teamA: [alex.id, "tok-guest"],
        teamB: [jordan.id, "no-such-user"],
        sets: SETS,
        newGuests: [{ token: "tok-guest", name: "Sam" }],
      }),
    ).rejects.toThrow();

    expect(await db.select().from(sessions)).toHaveLength(0);
    expect(await db.select().from(matches)).toHaveLength(0);
    expect((await db.select().from(users)).length).toBe(usersBefore);
    void priya;
  });

  it("guards the double record: the same four in the same circle around the same time is the same game", async () => {
    const { alex, priya, jordan, kwame, circle } = await fourInACircle(db);
    const playedAt = Date.now() - HOUR_MS;

    const first = await store.recordAdHocMatch({
      circleId: circle.id,
      reporterId: alex.id,
      playedAt,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: SETS,
    });

    // The other side records the same game (teams seen from their side).
    await expect(
      store.recordAdHocMatch({
        circleId: circle.id,
        reporterId: jordan.id,
        playedAt: playedAt + 20 * 60 * 1000,
        teamA: [jordan.id, kwame.id],
        teamB: [alex.id, priya.id],
        sets: [
          { a: 3, b: 6 },
          { a: 4, b: 6 },
        ],
      }),
    ).rejects.toThrow(MatchAlreadyRecordedError);

    // Only one session + match exist.
    expect(await db.select().from(sessions)).toHaveLength(1);
    expect(await db.select().from(matches)).toHaveLength(1);

    // A genuinely different game (same four, yesterday evening, outside the
    // window) records fine.
    const rematch = await store.recordAdHocMatch({
      circleId: circle.id,
      reporterId: alex.id,
      playedAt: playedAt - 20 * HOUR_MS,
      teamA: [alex.id, priya.id],
      teamB: [jordan.id, kwame.id],
      sets: SETS,
    });
    expect(rematch.matchId).not.toBe(first.matchId);
  });

  it("requires circle membership and a sane played-at window", async () => {
    const { alex, priya, jordan, kwame, circle } = await fourInACircle(db);
    const outsider = await insertUser(db, "zoe@example.com", "Zoe");

    await expect(
      store.recordAdHocMatch({
        circleId: circle.id,
        reporterId: outsider.id,
        playedAt: Date.now(),
        teamA: [outsider.id, priya.id],
        teamB: [jordan.id, kwame.id],
        sets: SETS,
      }),
    ).rejects.toThrow(/member/);

    const base = { circleId: circle.id, reporterId: alex.id, teamA: [alex.id, priya.id] as [string, string], teamB: [jordan.id, kwame.id] as [string, string], sets: SETS };
    await expect(store.recordAdHocMatch({ ...base, playedAt: Date.now() + HOUR_MS })).rejects.toThrow(/future/);
    await expect(store.recordAdHocMatch({ ...base, playedAt: Date.now() - AD_HOC_MAX_AGE_MS - HOUR_MS })).rejects.toThrow(/today and yesterday/);

    // Nothing was minted by any rejected attempt.
    expect(await db.select().from(sessions)).toHaveLength(0);
  });

  it("getAdHocCircles lists the viewer's circles with the default the match would inherit; getAdHocRosterContext pre-seats the viewer", async () => {
    const { alex, priya, jordan, kwame, circle } = await fourInACircle(db, "friendly");
    const outsider = await insertUser(db, "zoe@example.com", "Zoe");

    const options = await store.getAdHocCircles(alex.id);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ circleId: circle.id, circleName: "The Four", gameType: "friendly", memberCount: 4 });
    expect(await store.getAdHocCircles(outsider.id)).toHaveLength(0);

    const roster = await store.getAdHocRosterContext(circle.id, alex.id);
    expect(roster).not.toBeNull();
    expect(roster!.gameType).toBe("friendly");
    expect(roster!.confirmed.map((p) => p.id)).toEqual([alex.id]);
    expect(roster!.candidates.map((p) => p.id).sort()).toEqual([priya.id, jordan.id, kwame.id].sort());
    expect(roster!.viewerGlass).not.toBeNull();

    // Members only: no roster for an outsider.
    expect(await store.getAdHocRosterContext(circle.id, outsider.id)).toBeNull();
  });
});
