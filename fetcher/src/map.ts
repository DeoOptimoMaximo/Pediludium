import { WORLD_CUP } from './config.ts';
import type { MatchRow } from './db.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

/**
 * Map a SofaScore event object → our MatchRow. group_name is left null on purpose:
 * the upsert COALESCEs it so refresh ticks never wipe the group set by the backfill.
 */
export function matchRowOf(e: AnyObj): MatchRow {
  return {
    ss_id: e.id,
    tournament_id: WORLD_CUP.uniqueTournamentId,
    season_id: WORLD_CUP.seasonId2026,
    home_team_id: e.homeTeam?.id ?? null,
    away_team_id: e.awayTeam?.id ?? null,
    start_ts: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
    status_type: e.status?.type ?? null,
    status_code: e.status?.code ?? null,
    winner_code: e.winnerCode ?? null,
    home_score: e.homeScore?.current ?? e.homeScore?.display ?? null,
    away_score: e.awayScore?.current ?? e.awayScore?.display ?? null,
    home_score_ht: e.homeScore?.period1 ?? null,
    away_score_ht: e.awayScore?.period1 ?? null,
    round: e.roundInfo?.round ?? null,
    round_name: e.roundInfo?.name ?? null,
    group_name: null,
    raw: e,
  };
}
