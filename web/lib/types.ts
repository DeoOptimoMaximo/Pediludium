export interface WcMatch {
  ss_id: number;
  season_id: number | null;
  home_team_id: number | null;
  away_team_id: number | null;
  start_ts: string | null;
  status_type: string | null;
  status_code: number | null;
  winner_code: number | null;
  home_score: number | null;
  away_score: number | null;
  round: number | null;
  round_name: string | null;
  group_name: string | null;
  home_name: string | null;
  home_short: string | null;
  home_alpha2: string | null;
  away_name: string | null;
  away_short: string | null;
  away_alpha2: string | null;
}

export interface Prediction {
  match_id: number;
  model_version: string;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  exp_home_goals: number | null;
  exp_away_goals: number | null;
}

export interface StandingRow {
  season_id: number;
  group_name: string | null;
  team_id: number | null;
  position: number | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goals_for: number | null;
  goals_against: number | null;
  points: number | null;
  team: { name: string | null; short_name: string | null; country_alpha2: string | null } | null;
}

export interface Rating {
  team_id: number;
  rating: number;
  team: { name: string | null; short_name: string | null; country_alpha2: string | null } | null;
}

export interface TeamLite {
  ss_id: number;
  name: string | null;
  short_name: string | null;
  country_alpha2: string | null;
  is_national: boolean | null;
}

export interface TeamMatch {
  event_id: number;
  start_ts: string | null;
  is_home: boolean | null;
  opponent_id: number | null;
  opponent_name: string | null;
  opponent_alpha2: string | null;
  team_score: number | null;
  opponent_score: number | null;
  result: 'W' | 'D' | 'L' | null;
  tournament_name: string | null;
  season_year: string | null;
}

export interface EventSide {
  name: string | null;
  alpha2: string | null;
  score: number | null;
}
export interface EventDetail {
  event_id: number;
  start_ts: string | null;
  competition: string | null;
  round: string | null;
  status_type: string | null;
  home: EventSide;
  away: EventSide;
}

export interface TournamentSim {
  team_id: number;
  iterations: number | null;
  exp_group_points: number | null;
  p_win_group: number | null;
  p_runner_up: number | null;
  p_third: number | null;
  p_advance: number | null;
  p_r16: number | null;
  p_qf: number | null;
  p_sf: number | null;
  p_final: number | null;
  p_win_cup: number | null;
  team: { name: string | null; short_name: string | null; country_alpha2: string | null } | null;
}

/* ── prediction time series (from the hourly snapshot history) ─────────────
 * Compact points: [epoch_seconds, ...probabilities]. Consecutive identical
 * vectors are collapsed at export time, so a flat line = the model held its view. */

/** [t, p_home, p_draw, p_away] */
export type MatchSeriesPoint = [number, number, number, number];
/** [t, p_advance, p_win_cup, p_sf] */
export type TeamSeriesPoint = [number, number, number, number];
/** model_version → chronological points */
export type MatchSeries = Record<string, MatchSeriesPoint[]>;
export type TeamSeries = Record<string, TeamSeriesPoint[]>;

/** One finished match scored against the last pre-kickoff prediction. */
export interface CalibRow {
  match_id: number;
  kickoff: string;
  p: [number, number, number]; // home / draw / away
  outcome: 0 | 1 | 2; // index into p
  brier: number; // multiclass, 0 best … 2 worst (uniform guess: 0.667)
  logloss: number; // uniform guess: 1.0986
}
/** model_version → rows ordered by kickoff */
export type Calibration = Record<string, CalibRow[]>;

/* ── biggest movers: change in advance / title odds over a recent window ───── */
export interface MoverRow {
  team_id: number;
  p_advance: number | null;
  p_win_cup: number | null;
  p_sf: number | null;
  d_advance: number; // signed change vs the window's reference snapshot
  d_win_cup: number;
  team: { name: string | null; short_name: string | null; country_alpha2: string | null } | null;
}
export interface Movers {
  window_h: number;
  from: string | null; // reference snapshot time
  to: string | null; // latest snapshot time
  teams: MoverRow[];
}

/**
 * Pipeline health as published by the fetcher's health check into the `health` KV key
 * (docs/21 §2A). The site reads it only to be honest with visitors about data freshness —
 * during the 2026-07 outage the scorecard showed a nine-day-old result with no indication
 * that anything was wrong, which is the one thing a "verifiable predictions" site must not do.
 */
export interface Health {
  generated_at: string;
  level: 'ok' | 'warn' | 'red';
  checks: { id: string; level: 'ok' | 'warn' | 'red'; message: string; detail?: Record<string, unknown> }[];
}

// model_version identifiers used across the app (the schema versions predictions/sims)
export const BASELINE_MODEL = 'baseline-poisson-elo-v1';
export const DC_MODEL = 'dixon-coles-v1';
export const SIM_MODEL = 'mc-sim-v1';

export interface PredModel {
  key: 'dc' | 'baseline';
  version: string;
  label: string;
}
export const PRED_MODELS: Record<'dc' | 'baseline', PredModel> = {
  dc: { key: 'dc', version: DC_MODEL, label: 'Dixon-Coles' },
  baseline: { key: 'baseline', version: BASELINE_MODEL, label: 'Elo + Poisson' },
};
