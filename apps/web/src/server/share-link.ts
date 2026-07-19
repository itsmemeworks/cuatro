import { getShareLinkSupabase } from "@/lib/staging-supabase";

/*
 * Resolves opaque /s/[token] share links via the native app's own
 * `resolve_share_link` RPC (SECURITY DEFINER, anon+authenticated executable
 * — never touch the underlying `share_links` table directly, never use a
 * service-role key). Tokens are opaque strings, not UUIDs — no format
 * validation is possible or meaningful; the RPC is the only source of truth
 * on whether one resolves to anything.
 *
 * Contract (confirmed live against staging, migration 29):
 *   null / any RPC error / a response shape we don't recognise / an
 *   unsupported kind ALL mean the same thing to the caller: the designed
 *   generic not-found page. Never reveal whether a token previously
 *   existed — every failure mode looks identical from here.
 */

export interface ShareLinkGame {
  kind: "game";
  gameId: string;
  startsAt: string;
  cutoffAt: string;
  venueId: string;
  venueName: string;
  circleName: string | null;
  heldSeat: number | null;
  players: { seatNumber: number; firstName: string }[];
}

export interface ShareLinkCircle {
  kind: "circle";
  circleId: string;
  slug: string;
}

export interface ShareLinkProfile {
  kind: "profile";
  playerId: string;
  firstName: string;
}

export interface ShareLinkResult {
  kind: "result";
  sealedResultId: string;
  gameId: string;
}

export type ShareLinkView = ShareLinkGame | ShareLinkCircle | ShareLinkProfile | ShareLinkResult;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawRow = Record<string, any>;

/** Exported for testing only — resolveShareLink is the real entry point. */
export function parseRow(row: RawRow): ShareLinkView | null {
  if (!row || typeof row !== "object") return null;

  switch (row.kind) {
    case "game": {
      if (typeof row.game_id !== "string" || typeof row.starts_at !== "string" || typeof row.venue_name !== "string") {
        return null;
      }
      const players = Array.isArray(row.players)
        ? row.players
            .filter((p: RawRow) => typeof p?.first_name === "string" && typeof p?.seat_number === "number")
            .map((p: RawRow) => ({ seatNumber: p.seat_number as number, firstName: p.first_name as string }))
        : [];
      return {
        kind: "game",
        gameId: row.game_id,
        startsAt: row.starts_at,
        cutoffAt: typeof row.cutoff_at === "string" ? row.cutoff_at : row.starts_at,
        venueId: typeof row.venue_id === "string" ? row.venue_id : "",
        venueName: row.venue_name,
        circleName: typeof row.circle_name === "string" ? row.circle_name : null,
        heldSeat: typeof row.held_seat === "number" ? row.held_seat : null,
        players,
      };
    }
    case "circle": {
      if (typeof row.circle_id !== "string" || typeof row.slug !== "string") return null;
      return { kind: "circle", circleId: row.circle_id, slug: row.slug };
    }
    case "profile": {
      if (typeof row.player_id !== "string" || typeof row.first_name !== "string") return null;
      return { kind: "profile", playerId: row.player_id, firstName: row.first_name };
    }
    case "result": {
      if (typeof row.sealed_result_id !== "string" || typeof row.game_id !== "string") return null;
      return { kind: "result", sealedResultId: row.sealed_result_id, gameId: row.game_id };
    }
    default:
      return null;
  }
}

export async function resolveShareLink(token: string): Promise<ShareLinkView | null> {
  // No generated Database type is wired up for this deliberately separate
  // client (see @/lib/staging-supabase) — the RPC name/args aren't in its
  // (nonexistent) schema, so PostgREST's generic overloads can't resolve.
  // The actual response is validated below regardless (parseRow), so an
  // `any` cast here costs nothing in real type safety.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase: any = getShareLinkSupabase();
  const { data, error } = await supabase.rpc("resolve_share_link", { target_token: token });
  if (error || !data) return null;
  try {
    return parseRow(data as RawRow);
  } catch {
    return null;
  }
}
