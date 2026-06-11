import * as snapshot from './data-snapshot';
import * as supabase from './data-supabase';

/**
 * Data source facade. Two interchangeable backends:
 *   - supabase (default): local dev — live Postgres + Realtime (data-supabase.ts)
 *   - snapshot: public Cloudflare deploy — Workers KV blobs published by the home
 *     fetcher's hourly batch (data-snapshot.ts)
 * NEXT_PUBLIC_DATA_SOURCE is inlined at build time, so each build bakes in one backend.
 */
export const isSnapshot = process.env.NEXT_PUBLIC_DATA_SOURCE === 'snapshot';

const impl = isSnapshot ? snapshot : supabase;

export const getMatches = impl.getMatches;
export const getMatch = impl.getMatch;
export const getPredictions = impl.getPredictions;
export const getPrediction = impl.getPrediction;
export const getSimulations = impl.getSimulations;
export const getStandings = impl.getStandings;
export const getRatings = impl.getRatings;
export const getNationalTeams = impl.getNationalTeams;
export const getTeamInfo = impl.getTeamInfo;
export const getTeamUpcoming = impl.getTeamUpcoming;
export const getTeamHistory = impl.getTeamHistory;
export const getEventDetail = impl.getEventDetail;
export const getMatchSeries = impl.getMatchSeries;
export const getTeamSeries = impl.getTeamSeries;
export const getCalibration = impl.getCalibration;

/** Snapshot generation time, or null when reading live from Supabase. */
export const getSnapshotMeta: () => Promise<{ generated_at: string } | null> = isSnapshot
  ? snapshot.getSnapshotMeta
  : async () => null;
