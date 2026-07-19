import { describe, expect, it } from "vitest";
import { parseRow } from "@/server/share-link";

/**
 * Pure parsing/validation of the resolve_share_link RPC's response shape —
 * no network call (that's covered by manual verification against the real
 * RPC; see the PR description). Every malformed/unrecognised/unsupported
 * shape must fall back to null, the SAME outcome as "token doesn't exist" —
 * a caller must never be able to tell the difference.
 */
describe("parseRow", () => {
  it("parses a game row exactly as the contract specifies", () => {
    const view = parseRow({
      kind: "game",
      game_id: "a1000000-0000-4000-8000-000000000006",
      starts_at: "2026-07-24T10:16:06.831Z",
      cutoff_at: "2026-07-23T10:16:06.831Z",
      venue_id: "10000000-0000-4000-8000-000000000001",
      venue_name: "Padel Up Tyneside",
      circle_name: "Quayside Rally",
      held_seat: 4,
      shared_by: "363c2b1d-bb42-4623-93d0-9fd54c64f164",
      players: [
        { seat_number: 2, player_id: "x", first_name: "Amir" },
        { seat_number: 1, player_id: "y", first_name: "Hana" },
      ],
    });
    expect(view).toEqual({
      kind: "game",
      gameId: "a1000000-0000-4000-8000-000000000006",
      startsAt: "2026-07-24T10:16:06.831Z",
      cutoffAt: "2026-07-23T10:16:06.831Z",
      venueId: "10000000-0000-4000-8000-000000000001",
      venueName: "Padel Up Tyneside",
      circleName: "Quayside Rally",
      heldSeat: 4,
      players: [
        { seatNumber: 2, firstName: "Amir" },
        { seatNumber: 1, firstName: "Hana" },
      ],
    });
    // shared_by must never surface on the parsed view — never displayed.
    expect(view && "shared_by" in view).toBe(false);
    expect(view && "sharedBy" in view).toBe(false);
  });

  it("defaults a game's optional fields (no circle, no held seat, no players)", () => {
    const view = parseRow({
      kind: "game",
      game_id: "g1",
      starts_at: "2026-07-24T10:16:06.831Z",
      venue_name: "Padel Up Tyneside",
    });
    expect(view).toMatchObject({ kind: "game", circleName: null, heldSeat: null, players: [] });
  });

  it("parses circle, profile and result rows, dropping internal ids from anything but their own shape", () => {
    expect(parseRow({ kind: "circle", circle_id: "c1", slug: "quayside-rally", shared_by: "x" })).toEqual({
      kind: "circle",
      circleId: "c1",
      slug: "quayside-rally",
    });
    expect(parseRow({ kind: "profile", player_id: "p1", first_name: "Hana", shared_by: "x" })).toEqual({
      kind: "profile",
      playerId: "p1",
      firstName: "Hana",
    });
    expect(parseRow({ kind: "result", sealed_result_id: "r1", game_id: "g1", shared_by: "x" })).toEqual({
      kind: "result",
      sealedResultId: "r1",
      gameId: "g1",
    });
  });

  it("returns null for an unsupported kind (never throws, never guesses)", () => {
    expect(parseRow({ kind: "something-new", foo: "bar" })).toBeNull();
    expect(parseRow({})).toBeNull();
  });

  it("returns null for a row missing its kind's required fields, even with the right kind tag", () => {
    expect(parseRow({ kind: "game", venue_name: "Padel Up" })).toBeNull(); // no game_id/starts_at
    expect(parseRow({ kind: "circle", circle_id: "c1" })).toBeNull(); // no slug
    expect(parseRow({ kind: "profile", player_id: "p1" })).toBeNull(); // no first_name
    expect(parseRow({ kind: "result", game_id: "g1" })).toBeNull(); // no sealed_result_id
  });

  it("returns null for non-object input (null, undefined, a string, an array)", () => {
    expect(parseRow(null as never)).toBeNull();
    expect(parseRow(undefined as never)).toBeNull();
    expect(parseRow("nope" as never)).toBeNull();
  });

  it("filters malformed entries out of a game's players array instead of throwing", () => {
    const view = parseRow({
      kind: "game",
      game_id: "g1",
      starts_at: "2026-07-24T10:16:06.831Z",
      venue_name: "Padel Up Tyneside",
      players: [{ seat_number: 1, first_name: "Hana" }, { seat_number: "not-a-number", first_name: "Bad" }, null, "nope"],
    });
    expect(view).toMatchObject({ players: [{ seatNumber: 1, firstName: "Hana" }] });
  });
});
