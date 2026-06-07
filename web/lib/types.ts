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

export const BASELINE_MODEL = 'baseline-poisson-elo-v1';
