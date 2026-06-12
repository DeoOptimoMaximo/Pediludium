import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  DC_MODEL,
  SIM_MODEL,
  type Prediction,
  type Rating,
  type StandingRow,
  type TeamLite,
  type TeamMatch,
  type TournamentSim,
  type WcMatch,
} from './types';

/**
 * Snapshot-backed data source for the public Cloudflare deployment (nogomet.domovina.ai).
 * Reads Workers KV keys published by the fetcher's `npm run snapshot`:
 *   core          → matches, predictions, standings, ratings, sims, teams (one JSON blob)
 *   hist:{teamId} → per-team match history
 *   evs:{shard}   → precomputed EventDetails, sharded by event_id % EVENT_SHARDS
 * Same function signatures as data-supabase.ts; lib/data.ts picks the implementation.
 */

interface CoreSnapshot {
  generated_at: string;
  season_id: number;
  matches: WcMatch[];
  predictions: Record<string, Prediction[]>;
  simulations: Record<string, TournamentSim[]>;
  standings: StandingRow[];
  ratings: Rating[];
  national_teams: (TeamLite & { rating: number | null })[];
  teams: Record<string, TeamLite>;
}

interface KvNamespace {
  get(key: string, type: 'json'): Promise<unknown>;
}

function kv(): KvNamespace {
  const { env } = getCloudflareContext();
  const ns = (env as Record<string, unknown>).SNAPSHOT as KvNamespace | undefined;
  if (!ns) throw new Error('Missing SNAPSHOT KV binding (wrangler.jsonc kv_namespaces)');
  return ns;
}

// per-isolate cache: every page render calls several getters — read `core` from KV once
// per minute instead of once per call (snapshots only change when the publisher runs)
let coreCache: { at: number; core: CoreSnapshot } | null = null;
const CORE_TTL_MS = 60_000;

async function getCore(): Promise<CoreSnapshot> {
  if (coreCache && Date.now() - coreCache.at < CORE_TTL_MS) return coreCache.core;
  const core = (await kv().get('core', 'json')) as CoreSnapshot | null;
  if (!core) throw new Error('Snapshot not published yet (KV key `core` missing)');
  coreCache = { at: Date.now(), core };
  return core;
}

/** When the published snapshot was generated (null in supabase/dev mode). */
export async function getSnapshotMeta(): Promise<{ generated_at: string } | null> {
  const core = await getCore();
  return { generated_at: core.generated_at };
}

export async function getMatches(): Promise<WcMatch[]> {
  return (await getCore()).matches;
}

export async function getMatch(id: number): Promise<WcMatch | null> {
  return (await getCore()).matches.find((m) => m.ss_id === id) ?? null;
}

export async function getPredictions(model: string = DC_MODEL): Promise<Map<number, Prediction>> {
  const rows = (await getCore()).predictions[model] ?? [];
  const map = new Map<number, Prediction>();
  for (const p of rows) map.set(p.match_id, p);
  return map;
}

export async function getPrediction(matchId: number, model: string = DC_MODEL): Promise<Prediction | null> {
  const rows = (await getCore()).predictions[model] ?? [];
  return rows.find((p) => p.match_id === matchId) ?? null;
}

export async function getSimulations(model: string = SIM_MODEL): Promise<TournamentSim[]> {
  return (await getCore()).simulations[model] ?? [];
}

export async function getStandings(): Promise<StandingRow[]> {
  return (await getCore()).standings;
}

export async function getRatings(): Promise<Rating[]> {
  return (await getCore()).ratings;
}

export async function getNationalTeams(): Promise<(TeamLite & { rating: number | null })[]> {
  return (await getCore()).national_teams;
}

export async function getTeamInfo(id: number): Promise<TeamLite | null> {
  return (await getCore()).teams[String(id)] ?? null;
}

export async function getTeamUpcoming(id: number): Promise<WcMatch[]> {
  return (await getCore()).matches.filter(
    (m) => (m.home_team_id === id || m.away_team_id === id) && m.status_type !== 'finished',
  );
}

export async function getTeamHistory(id: number): Promise<TeamMatch[]> {
  return ((await kv().get(`hist:${id}`, 'json')) as TeamMatch[] | null) ?? [];
}

/** All WC2026 matches involving this team (past + future), chronological. */
export async function getTeamWcMatches(id: number): Promise<WcMatch[]> {
  return (await getCore()).matches
    .filter((m) => m.home_team_id === id || m.away_team_id === id)
    .sort((a, b) => (a.start_ts ?? '').localeCompare(b.start_ts ?? ''));
}

// must match EVENT_SHARDS / MSER_SHARDS in fetcher/src/export-snapshot.ts
const EVENT_SHARDS = 64;
const MSER_SHARDS = 16;

/** How p_home/p_draw/p_away evolved across snapshots for one match (per model). */
export async function getMatchSeries(matchId: number): Promise<import('./types').MatchSeries | null> {
  const shard = (await kv().get(`mser:${matchId % MSER_SHARDS}`, 'json')) as Record<
    string,
    import('./types').MatchSeries
  > | null;
  return shard?.[String(matchId)] ?? null;
}

/** How p_advance/p_win_cup evolved across snapshots for one team (per sim model). */
export async function getTeamSeries(teamId: number): Promise<import('./types').TeamSeries | null> {
  return ((await kv().get(`tser:${teamId}`, 'json')) as import('./types').TeamSeries | null) ?? null;
}

/** Pre-kickoff predictions of finished matches scored per model (precomputed at export). */
export async function getCalibration(): Promise<import('./types').Calibration> {
  return ((await kv().get('calib', 'json')) as import('./types').Calibration | null) ?? {};
}

/** Per-team change in advance / title odds over the recent window (swing chart). */
export async function getMovers(): Promise<import('./types').Movers | null> {
  return ((await kv().get('movers', 'json')) as import('./types').Movers | null) ?? null;
}

export async function getEventDetail(eventId: number): Promise<import('./types').EventDetail | null> {
  const shard = (await kv().get(`evs:${eventId % EVENT_SHARDS}`, 'json')) as Record<
    string,
    import('./types').EventDetail
  > | null;
  return shard?.[String(eventId)] ?? null;
}
