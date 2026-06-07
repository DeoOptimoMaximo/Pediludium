import { supa } from './supabase';
import {
  BASELINE_MODEL,
  type Prediction,
  type Rating,
  type StandingRow,
  type TeamLite,
  type TeamMatch,
  type WcMatch,
} from './types';

/** All WC2026 matches (via the wc2026_match view), chronological. */
export async function getMatches(): Promise<WcMatch[]> {
  const { data, error } = await supa()
    .from('wc2026_match')
    .select('*')
    .order('start_ts', { ascending: true });
  if (error) throw error;
  return (data ?? []) as WcMatch[];
}

export async function getMatch(id: number): Promise<WcMatch | null> {
  const { data, error } = await supa().from('wc2026_match').select('*').eq('ss_id', id).maybeSingle();
  if (error) throw error;
  return (data as WcMatch) ?? null;
}

/** Baseline predictions keyed by match id. */
export async function getPredictions(): Promise<Map<number, Prediction>> {
  const { data, error } = await supa().from('prediction').select('*').eq('model_version', BASELINE_MODEL);
  if (error) throw error;
  const map = new Map<number, Prediction>();
  for (const p of (data ?? []) as Prediction[]) map.set(p.match_id, p);
  return map;
}

export async function getPrediction(matchId: number): Promise<Prediction | null> {
  const { data, error } = await supa()
    .from('prediction')
    .select('*')
    .eq('model_version', BASELINE_MODEL)
    .eq('match_id', matchId)
    .maybeSingle();
  if (error) throw error;
  return (data as Prediction) ?? null;
}

export async function getStandings(): Promise<StandingRow[]> {
  const { data, error } = await supa()
    .from('standing')
    .select('*, team:team_id(name, short_name, country_alpha2)')
    .order('group_name', { ascending: true })
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as StandingRow[];
}

/** Elo power ranking (latest per team, highest first). */
export async function getRatings(): Promise<Rating[]> {
  const { data, error } = await supa()
    .from('team_rating')
    .select('team_id, rating, as_of, team:team_id(name, short_name, country_alpha2)')
    .eq('model', 'elo')
    .order('as_of', { ascending: false });
  if (error) throw error;
  const seen = new Set<number>();
  const out: Rating[] = [];
  for (const r of (data ?? []) as unknown as (Rating & { as_of: string })[]) {
    if (seen.has(r.team_id)) continue;
    seen.add(r.team_id);
    out.push({ team_id: r.team_id, rating: r.rating, team: r.team });
  }
  out.sort((a, b) => b.rating - a.rating);
  return out;
}

/** All national teams with their Elo rating, sorted by rating desc. */
export async function getNationalTeams(): Promise<(TeamLite & { rating: number | null })[]> {
  const [{ data, error }, ratings] = await Promise.all([
    supa().from('team').select('ss_id, name, short_name, country_alpha2, is_national').eq('is_national', true),
    getRatings(),
  ]);
  if (error) throw error;
  const rmap = new Map(ratings.map((r) => [r.team_id, r.rating]));
  const teams = (data ?? []) as TeamLite[];
  return teams
    .map((t) => ({ ...t, rating: rmap.get(t.ss_id) ?? null }))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (a.name ?? '').localeCompare(b.name ?? ''));
}

export async function getTeamInfo(id: number): Promise<TeamLite | null> {
  const { data, error } = await supa()
    .from('team')
    .select('ss_id, name, short_name, country_alpha2, is_national')
    .eq('ss_id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as TeamLite) ?? null;
}

/** A team's historical matches, newest first. */
export async function getTeamHistory(id: number): Promise<TeamMatch[]> {
  const { data, error } = await supa()
    .from('team_match')
    .select(
      'event_id, start_ts, is_home, opponent_id, opponent_name, opponent_alpha2, team_score, opponent_score, result, tournament_name, season_year',
    )
    .eq('team_id', id)
    .order('start_ts', { ascending: false });
  if (error) throw error;
  return (data ?? []) as TeamMatch[];
}
