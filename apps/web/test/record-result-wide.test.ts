/**
 * Wave C A2 — the wide record-a-result overlay's server + pure pieces:
 * - getRosterContext's courtSide surfacing and viewerGlass (seal-preview inputs)
 * - getRecordableSessions (the overlay's "Which game was it?" step)
 * - seatPair / seatSide (roster seated by preferred side, issue #21)
 * - previewSeal (consumes @cuatro/glass's processMatch — asserted against a
 *   REAL recorded-and-sealed match so the preview can never drift from the engine)
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { circleMembers, circles, createTestClient, ratingEvents, rsvps, sessions, users, venues, type CuatroDb } from "@cuatro/db";
import { createMatchesStoreFromClient, type MatchesStore } from "@/server/matches-db";
import { seatPair, seatSide } from "@/components/matches/wide/seating";
import { previewSeal, sealPreviewLine } from "@/components/matches/wide/seal-preview";

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertUser(db: CuatroDb, email: string, displayName: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db.insert(users).values({ email, displayName, ...extra }).returning();
  return row;
}

async function insertCircle(db: CuatroDb, createdBy: string, name = "Test Circle") {
  const [circle] = await db
    .insert(circles)
    .values({ name, inviteCode: `INV-${Math.random().toString(36).slice(2, 10)}`, createdBy })
    .returning();
  return circle;
}

async function insertSession(db: CuatroDb, circleId: string, startsAt: Date, extra: Partial<typeof sessions.$inferInsert> = {}) {
  const [session] = await db
    .insert(sessions)
    .values({ circleId, startsAt: startsAt.getTime(), status: "played", ...extra })
    .returning();
  return session;
}

async function addMember(db: CuatroDb, circleId: string, userId: string) {
  await db.insert(circleMembers).values({ circleId, userId, role: "member" });
}

async function rsvpIn(db: CuatroDb, sessionId: string, userId: string, respondedAt: Date) {
  await db.insert(rsvps).values({ sessionId, userId, status: "in", respondedAt: respondedAt.getTime(), source: "rsvp" });
}

describe("wide record-a-result server pieces", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(async () => {
    store = createMatchesStoreFromClient(await createTestClient());
    db = store.db;
  });

  afterEach(async () => {
    await store.close();
  });

  it("getRosterContext surfaces courtSide on confirmed players and candidates", async () => {
    const drive = await insertUser(db, "drive@example.com", "Dree", { courtSide: "right" });
    const backhand = await insertUser(db, "backhand@example.com", "Bea", { courtSide: "left" });
    const unset = await insertUser(db, "unset@example.com", "Uma");
    const both = await insertUser(db, "both@example.com", "Bo", { courtSide: "both" });
    const circle = await insertCircle(db, drive.id);
    for (const u of [drive, backhand, unset, both]) await addMember(db, circle.id, u.id);
    const session = await insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
    await rsvpIn(db, session.id, drive.id, new Date(Date.now() - 2 * DAY_MS));
    await rsvpIn(db, session.id, backhand.id, new Date(Date.now() - 2 * DAY_MS + 1000));

    const ctx = (await store.getRosterContext(session.id, drive.id))!;
    expect(ctx.confirmed.map((p) => [p.displayName, p.courtSide])).toEqual([
      ["Dree", "right"],
      ["Bea", "left"],
    ]);
    const bySide = Object.fromEntries(ctx.candidates.map((p) => [p.displayName, p.courtSide]));
    expect(bySide["Uma"]).toBeNull();
    expect(bySide["Bo"]).toBe("both");
  });

  it("getRosterContext.viewerGlass carries public rating state, opponents faced, and recent fixtures", async () => {
    // Build REAL history: record and seal one match, then open a fresh
    // session the next day and inspect what the viewer's preview would know.
    const a = await insertUser(db, "a@example.com", "Ada");
    const b = await insertUser(db, "b@example.com", "Ben");
    const c = await insertUser(db, "c@example.com", "Cy");
    const d = await insertUser(db, "d@example.com", "Di");
    const circle = await insertCircle(db, a.id);
    for (const u of [a, b, c, d]) await addMember(db, circle.id, u.id);
    const played = await insertSession(db, circle.id, new Date(Date.now() - 2 * DAY_MS));
    const { matchId } = await store.recordMatch({
      sessionId: played.id,
      reporterId: a.id,
      teamA: [a.id, b.id],
      teamB: [c.id, d.id],
      sets: [{ a: 6, b: 3 }],
    });
    await store.confirmMatch(matchId, c.id);

    const next = await insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
    const ctx = (await store.getRosterContext(next.id, a.id))!;
    const glass = ctx.viewerGlass!;

    // 1 verified match: still mid-Trio, so the PUBLIC rating stays null (the
    // hidden internal rating must never ride along).
    expect(glass.verifiedMatchCount).toBe(1);
    expect(glass.rating).toBeNull();
    // Faced exactly the two opponents from the sealed match.
    expect([...glass.opponentsFaced].sort()).toEqual([c.id, d.id].sort());
    // The sealed match is inside the 30-day Echo Damping window.
    expect(glass.recentFixtures).toHaveLength(1);
    expect([...glass.recentFixtures[0]!.playerIds].sort()).toEqual([a.id, b.id, c.id, d.id].sort());
    // Confidence mirrors users.confidence as a percentage.
    const [row] = await db.select({ confidence: users.confidence }).from(users).where(eq(users.id, a.id));
    expect(glass.confidencePct).toBe(Math.round(row!.confidence * 100));
  });

  it("getRecordableSessions lists the viewer's recent played games with their match state", async () => {
    const me = await insertUser(db, "me@example.com", "Mel");
    const p2 = await insertUser(db, "p2@example.com", "Pat");
    const p3 = await insertUser(db, "p3@example.com", "Quin");
    const p4 = await insertUser(db, "p4@example.com", "Rio");
    const circle = await insertCircle(db, me.id, "Tuesday Lot");
    for (const u of [me, p2, p3, p4]) await addMember(db, circle.id, u.id);
    const [venue] = await db.insert(venues).values({ name: "Powerhall" }).returning();

    const loggable = await insertSession(db, circle.id, new Date(Date.now() - DAY_MS), { venueId: venue!.id });
    const sealedSession = await insertSession(db, circle.id, new Date(Date.now() - 3 * DAY_MS));
    const pendingSession = await insertSession(db, circle.id, new Date(Date.now() - 5 * DAY_MS));
    // Outside the window / wrong state / wrong circle — all invisible.
    await insertSession(db, circle.id, new Date(Date.now() - 20 * DAY_MS));
    await insertSession(db, circle.id, new Date(Date.now() + DAY_MS));
    await insertSession(db, circle.id, new Date(Date.now() - DAY_MS), { status: "cancelled" });
    const stranger = await insertUser(db, "stranger@example.com", "Sol");
    const otherCircle = await insertCircle(db, stranger.id, "Not Yours");
    await insertSession(db, otherCircle.id, new Date(Date.now() - DAY_MS));

    const sealed = await store.recordMatch({
      sessionId: sealedSession.id,
      reporterId: me.id,
      teamA: [me.id, p2.id],
      teamB: [p3.id, p4.id],
      sets: [{ a: 6, b: 2 }],
    });
    await store.confirmMatch(sealed.matchId, p3.id);
    const pending = await store.recordMatch({
      sessionId: pendingSession.id,
      reporterId: me.id,
      teamA: [me.id, p2.id],
      teamB: [p3.id, p4.id],
      sets: [{ a: 6, b: 4 }],
    });

    const rows = await store.getRecordableSessions(me.id);
    expect(rows.map((r) => r.sessionId)).toEqual([loggable.id, sealedSession.id, pendingSession.id]);
    expect(rows[0]).toMatchObject({ circleName: "Tuesday Lot", venueName: "Powerhall", match: null });
    expect(rows[1]!.match).toMatchObject({ id: sealed.matchId, status: "verified" });
    expect(rows[2]!.match).toMatchObject({ id: pending.matchId, status: "pending_confirmation" });
  });
});

describe("seating by preferred side (soft signal only)", () => {
  const p = (courtSide: "right" | "left" | "both" | null, name: string) => ({ courtSide, name });

  it("team A tops with drive, team B mirrors with backhand on top", () => {
    expect(seatSide("A", 0)).toBe("right");
    expect(seatSide("A", 1)).toBe("left");
    expect(seatSide("B", 0)).toBe("left");
    expect(seatSide("B", 1)).toBe("right");
  });

  it("seats a drive/backhand pair onto their sides in both orientations", () => {
    const drive = p("right", "Dree");
    const backhand = p("left", "Bea");
    expect(seatPair([backhand, drive], "A").map((x) => x.name)).toEqual(["Dree", "Bea"]);
    expect(seatPair([drive, backhand], "A").map((x) => x.name)).toEqual(["Dree", "Bea"]);
    expect(seatPair([drive, backhand], "B").map((x) => x.name)).toEqual(["Bea", "Dree"]);
  });

  it("null/'both' expresses no preference and never displaces anyone", () => {
    const drive = p("right", "Dree");
    const none = p(null, "Uma");
    const both = p("both", "Bo");
    // Uma has no claim on the drive seat; Dree takes it either way.
    expect(seatPair([none, drive], "A").map((x) => x.name)).toEqual(["Dree", "Uma"]);
    expect(seatPair([both, none], "A").map((x) => x.name)).toEqual(["Bo", "Uma"]);
    // Two same-side players keep their incoming order (nothing to argue).
    expect(seatPair([p("right", "R1"), p("right", "R2")], "A").map((x) => x.name)).toEqual(["R1", "R2"]);
  });
});

describe("previewSeal (engine-backed, never a reimplementation)", () => {
  let store: MatchesStore;
  let db: CuatroDb;

  beforeEach(async () => {
    store = createMatchesStoreFromClient(await createTestClient());
    db = store.db;
  });

  afterEach(async () => {
    await store.close();
  });

  it("predicts exactly what a real seal writes to the viewer's Ledger", async () => {
    // Rate four players the only honest way: three genuinely sealed matches
    // (the Placement Trio) among the same four. Then preview a fourth game —
    // repeat fixture, so Echo Damping is live too — and compare against the
    // genuine recordMatch -> confirmMatch Ledger row.
    const sam = await insertUser(db, "sam@example.com", "Sam");
    const mags = await insertUser(db, "mags@example.com", "Mags");
    const kav = await insertUser(db, "kav@example.com", "Kav");
    const tom = await insertUser(db, "tom@example.com", "Tom");
    const circle = await insertCircle(db, sam.id);
    for (const u of [sam, mags, kav, tom]) await addMember(db, circle.id, u.id);

    const trioScores: [number, number][] = [
      [6, 3],
      [4, 6],
      [7, 5],
    ];
    for (let i = 0; i < 3; i++) {
      const s = await insertSession(db, circle.id, new Date(Date.now() - (10 - 2 * i) * DAY_MS));
      const { matchId } = await store.recordMatch({
        sessionId: s.id,
        reporterId: sam.id,
        teamA: [sam.id, mags.id],
        teamB: [kav.id, tom.id],
        sets: [{ a: trioScores[i]![0], b: trioScores[i]![1] }],
      });
      await store.confirmMatch(matchId, kav.id);
    }

    const ratingOf = async (id: string) => (await db.select({ r: users.rating }).from(users).where(eq(users.id, id)))[0]!.r!;
    const session = await insertSession(db, circle.id, new Date(Date.now() - DAY_MS));
    const sets = [
      { a: 7, b: 5 },
      { a: 6, b: 4 },
    ];
    const ctx = (await store.getRosterContext(session.id, sam.id))!;
    expect(ctx.viewerGlass!.rating).not.toBeNull();
    expect(ctx.viewerGlass!.recentFixtures).toHaveLength(3);
    const preview = previewSeal({
      viewerId: sam.id,
      viewerGlass: ctx.viewerGlass!,
      teamA: [
        { id: sam.id, rating: await ratingOf(sam.id) },
        { id: mags.id, rating: await ratingOf(mags.id) },
      ],
      teamB: [
        { id: kav.id, rating: await ratingOf(kav.id) },
        { id: tom.id, rating: await ratingOf(tom.id) },
      ],
      sets,
      playedAtMs: session.startsAt,
    })!;
    expect(preview).not.toBeNull();
    expect(preview.won).toBe(true);

    const { matchId } = await store.recordMatch({
      sessionId: session.id,
      reporterId: sam.id,
      teamA: [sam.id, mags.id],
      teamB: [kav.id, tom.id],
      sets,
    });
    await store.confirmMatch(matchId, kav.id);
    const events = await db.select().from(ratingEvents).where(eq(ratingEvents.matchId, matchId));
    const samEvent = events.find((e) => e.userId === sam.id)!;

    expect(preview.delta).toBeCloseTo(samEvent.delta, 10);
    expect(preview.ratingAfter).toBeCloseTo(samEvent.ratingAfter, 10);
    expect(preview.expectedWinPct).toBe(Math.round(samEvent.factors.expectedWin * 100));
    expect(preview.confidenceAfterPct).toBe(Math.round(samEvent.confidenceAfter * 100));
  });

  it("goes quiet instead of guessing: unrated player on court, no winner, or a viewer mid-Trio", () => {
    const glass = { rating: 4.5, confidencePct: 60, verifiedMatchCount: 5, opponentsFaced: [], recentFixtures: [] };
    const teamA: [{ id: string; rating: number | null }, { id: string; rating: number | null }] = [
      { id: "v", rating: 4.5 },
      { id: "p", rating: 4.2 },
    ];
    const teamB: [{ id: string; rating: number | null }, { id: string; rating: number | null }] = [
      { id: "q", rating: 4.8 },
      { id: "r", rating: 4.6 },
    ];
    const base = { viewerId: "v", viewerGlass: glass, teamA, teamB, playedAtMs: Date.now() };

    expect(previewSeal({ ...base, sets: [{ a: 6, b: 4 }] })).not.toBeNull();
    // A guest / mid-Trio player has no public rating: no preview, no leak.
    expect(previewSeal({ ...base, teamB: [{ id: "q", rating: null }, teamB[1]], sets: [{ a: 6, b: 4 }] })).toBeNull();
    // Level score: a preview never guesses a winner.
    expect(previewSeal({ ...base, sets: [{ a: 6, b: 6 }] })).toBeNull();
    expect(previewSeal({ ...base, sets: [] })).toBeNull();
    // Viewer's own Glass still pouring.
    expect(previewSeal({ ...base, viewerGlass: { ...glass, rating: null }, sets: [{ a: 6, b: 4 }] })).toBeNull();
  });

  it("phrases the hint per the design, copy laws intact", () => {
    const win = sealPreviewLine({ expectedWinPct: 38, delta: 0.05, ratingAfter: 4.67, confidenceBeforePct: 78, confidenceAfterPct: 80, won: true });
    expect(win).toBe("Expected win 38%. A win here moves you about +0.05, confidence 78% to 80%");
    const loss = sealPreviewLine({ expectedWinPct: 62, delta: -0.04, ratingAfter: 4.58, confidenceBeforePct: 78, confidenceAfterPct: 80, won: false });
    expect(loss).toBe("Expected win 62%. This one moves you about -0.04, confidence 78% to 80%");
    for (const line of [win, loss]) {
      expect(line).not.toMatch(/—|!/);
    }
  });
});
