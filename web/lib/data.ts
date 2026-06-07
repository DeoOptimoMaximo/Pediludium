import { supa } from './supabase';
import { BASELINE_MODEL, type Prediction, type Rating, type StandingRow, type WcMatch } from './types';

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
