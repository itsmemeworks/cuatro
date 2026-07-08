import { DEFAULT_STARTING_RATING, PLACEMENT_TRIO_SIZE, CONFIDENCE_STEP } from "./constants.js";
import { buildExplanation } from "./explanation.js";
import {
  clampConfidence,
  clampRating,
  confidenceMultiplier,
  echoDamping,
  kFor,
  marginMultiplier,
  round2,
  winExpectancy,
} from "./rating-math.js";
import type {
  LedgerEvent,
  MatchInput,
  PlayerCreationOptions,
  PlayerId,
  PlayerState,
  PlayerStatus,
  ProcessMatchInput,
  ProcessMatchResult,
} from "./types.js";

/** Creates a fresh, Unrated player. `placementPrior` seeds the hidden starting rating only. */
export function createPlayer(playerId: PlayerId, options: PlayerCreationOptions = {}): PlayerState {
  const rating =
    options.placementPrior !== undefined
      ? clampRating(round2(options.placementPrior))
      : DEFAULT_STARTING_RATING;
  return {
    playerId,
    rating,
    confidence: 0,
    matchesPlayed: 0,
    opponentsFaced: [],
  };
}

/** A player is "rated" (has a public Glass number) once their Placement Trio is complete. */
export function playerStatus(player: PlayerState): PlayerStatus {
  return player.matchesPlayed >= PLACEMENT_TRIO_SIZE ? "rated" : "unrated";
}

interface TeamContext {
  readonly players: readonly [PlayerState, PlayerState];
  readonly side: "A" | "B";
  readonly expectancy: number;
  readonly ownRatingAvg: number;
  readonly oppRatingAvg: number;
  readonly opponentIds: readonly [PlayerId, PlayerId];
}

/**
 * Applies one verified match to the four players involved and returns their
 * new states plus one Ledger event per player. Pure: no I/O, no system
 * clock — everything it needs (ratings, history, "now") is an argument.
 *
 * Returns `{ status: "skipped", reason }` without touching any state when the
 * match shouldn't move ratings at all (unverified, walkover, or no games
 * actually played) — see README "Walkover & retired policy".
 */
export function processMatch(input: ProcessMatchInput): ProcessMatchResult {
  const { match, players, recentFixtures = [], opponentNames } = input;

  if (!match.verified) {
    return { status: "skipped", reason: "unverified" };
  }

  const outcome = match.outcome ?? "completed";
  if (outcome === "walkover") {
    return { status: "skipped", reason: "walkover" };
  }

  if (match.gamesWonA < 0 || match.gamesWonB < 0) {
    throw new RangeError("Games won cannot be negative");
  }

  const totalGames = match.gamesWonA + match.gamesWonB;
  if (totalGames <= 0) {
    return { status: "skipped", reason: outcome === "retired" ? "retired-no-games" : "no-games-played" };
  }

  const allIds: PlayerId[] = [...match.teamA, ...match.teamB];
  if (new Set(allIds).size !== 4) {
    throw new Error("A match must involve four distinct players");
  }
  for (const id of allIds) {
    if (!players[id]) {
      throw new Error(`Missing player state for player "${id}"`);
    }
  }

  const teamAPlayers: [PlayerState, PlayerState] = [players[match.teamA[0]]!, players[match.teamA[1]]!];
  const teamBPlayers: [PlayerState, PlayerState] = [players[match.teamB[0]]!, players[match.teamB[1]]!];
  const teamARatingAvg = (teamAPlayers[0].rating + teamAPlayers[1].rating) / 2;
  const teamBRatingAvg = (teamBPlayers[0].rating + teamBPlayers[1].rating) / 2;

  const expectancyA = winExpectancy(teamARatingAvg, teamBRatingAvg);
  const expectancyB = 1 - expectancyA;

  const winningTeamGamesWon = match.winner === "A" ? match.gamesWonA : match.gamesWonB;
  const margin = marginMultiplier(winningTeamGamesWon, totalGames);

  const fixturePlayerIds = allIds as [PlayerId, PlayerId, PlayerId, PlayerId];
  const { multiplier: damping, occurrence } = echoDamping(match.playedAt, fixturePlayerIds, recentFixtures);

  const updatedPlayers: Record<PlayerId, PlayerState> = { ...players };
  const ledgerEvents: LedgerEvent[] = [];

  const teams: readonly TeamContext[] = [
    {
      players: teamAPlayers,
      side: "A",
      expectancy: expectancyA,
      ownRatingAvg: teamARatingAvg,
      oppRatingAvg: teamBRatingAvg,
      opponentIds: match.teamB,
    },
    {
      players: teamBPlayers,
      side: "B",
      expectancy: expectancyB,
      ownRatingAvg: teamBRatingAvg,
      oppRatingAvg: teamARatingAvg,
      opponentIds: match.teamA,
    },
  ];

  for (const team of teams) {
    const won = match.winner === team.side;
    const ownGamesWon = team.side === "A" ? match.gamesWonA : match.gamesWonB;
    const ownShare = ownGamesWon / totalGames;

    for (const player of team.players) {
      const K = kFor(player.matchesPlayed);
      const confMult = confidenceMultiplier(player.confidence);
      const actual = won ? 1 : 0;
      const rawDelta = K * (actual - team.expectancy) * margin * confMult * damping;

      const ratingBefore = player.rating;
      const ratingAfter = round2(clampRating(ratingBefore + rawDelta));
      const delta = round2(ratingAfter - ratingBefore);

      const newOpponents = team.opponentIds.filter((id) => !player.opponentsFaced.includes(id));
      const confidenceBefore = player.confidence;
      const confidenceAfter = clampConfidence(confidenceBefore + newOpponents.length * CONFIDENCE_STEP);
      const opponentsFaced =
        newOpponents.length > 0 ? [...player.opponentsFaced, ...newOpponents] : player.opponentsFaced;

      updatedPlayers[player.playerId] = {
        playerId: player.playerId,
        rating: ratingAfter,
        confidence: confidenceAfter,
        matchesPlayed: player.matchesPlayed + 1,
        opponentsFaced,
      };

      const explanation = buildExplanation({
        delta,
        won,
        ownTeamRatingAvg: team.ownRatingAvg,
        oppTeamRatingAvg: team.oppRatingAvg,
        ownShare,
        occurrence,
        dampingMultiplier: damping,
        opponentIds: team.opponentIds,
        opponentNames,
      });

      ledgerEvents.push({
        playerId: player.playerId,
        matchId: match.matchId,
        delta,
        ratingBefore,
        ratingAfter,
        confidenceBefore,
        confidenceAfter,
        factors: {
          expectancy: team.expectancy,
          margin,
          echoDamping: damping,
          kUsed: K,
        },
        explanation,
      });
    }
  }

  return { status: "applied", updatedPlayers, ledgerEvents };
}
