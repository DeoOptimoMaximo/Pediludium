import { supa } from './supabase';
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

/** Predictions keyed by match id. Defaults to the Dixon-Coles model (best available). */
export async function getPredictions(model: string = DC_MODEL): Promise<Map<number, Prediction>> {
  const { data, error } = await supa().from('prediction').select('*').eq('model_version', model);
  if (error) throw error;
  const map = new Map<number, Prediction>();
  for (const p of (data ?? []) as Prediction[]) map.set(p.match_id, p);
  return map;
}

export async function getPrediction(matchId: number, model: string = DC_MODEL): Promise<Prediction | null> {
  const { data, error } = await supa()
    .from('prediction')
    .select('*')
    .eq('model_version', model)
    .eq('match_id', matchId)
    .maybeSingle();
  if (error) throw error;
  return (data as Prediction) ?? null;
}

/** Monte-Carlo tournament simulation rows, longest title odds first. */
export async function getSimulations(model: string = SIM_MODEL): Promise<TournamentSim[]> {
  const { data, error } = await supa()
    .from('tournament_simulation')
    .select('*, team:team_id(name, short_name, country_alpha2)')
    .eq('model_version', model)
    .order('p_win_cup', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as TournamentSim[];
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

/** A team's upcoming WC2026 fixtures (not yet finished), soonest first. */
export async function getTeamUpcoming(id: number): Promise<WcMatch[]> {
  const { data, error } = await supa()
    .from('wc2026_match')
    .select('*')
    .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
    .neq('status_type', 'finished')
    .order('start_ts', { ascending: true });
  if (error) throw error;
  return (data ?? []) as WcMatch[];
}

/** All WC2026 matches involving this team (past + future), chronological. */
export async function getTeamWcMatches(id: number): Promise<WcMatch[]> {
  const { data, error } = await supa()
    .from('wc2026_match')
    .select('*')
    .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
    .order('start_ts', { ascending: true });
  if (error) throw error;
  return (data ?? []) as WcMatch[];
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

/* ── prediction time series (append-only history tables) ─────────────────── */

const r4 = (v: number | null) => Math.round((v ?? 0) * 10000) / 10000;

/** Collapse consecutive points whose probability vector didn't change. */
function dedupe<T extends number[]>(pts: T[]): T[] {
  const out: T[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && prev.every((v, i) => i === 0 || v === p[i])) continue;
    out.push(p);
  }
  return out;
}

/** How p_home/p_draw/p_away evolved across snapshots for one match (per model). */
export async function getMatchSeries(matchId: number): Promise<import('./types').MatchSeries | null> {
  const { data, error } = await supa()
    .from('prediction_history')
    .select('model_version, captured_at, p_home, p_draw, p_away')
    .eq('match_id', matchId)
    .order('captured_at', { ascending: true });
  if (error) throw error;
  if (!data?.length) return null;
  const out: import('./types').MatchSeries = {};
  for (const r of data) {
    (out[r.model_version] ??= []).push([
      Math.floor(new Date(r.captured_at).getTime() / 1000),
      r4(r.p_home), r4(r.p_draw), r4(r.p_away),
    ]);
  }
  for (const m of Object.keys(out)) out[m] = dedupe(out[m]!);
  return out;
}

/** How p_advance/p_win_cup evolved across snapshots for one team (per sim model). */
export async function getTeamSeries(teamId: number): Promise<import('./types').TeamSeries | null> {
  const { data, error } = await supa()
    .from('simulation_history')
    .select('model_version, captured_at, p_advance, p_win_cup, p_sf')
    .eq('team_id', teamId)
    .order('captured_at', { ascending: true });
  if (error) throw error;
  if (!data?.length) return null;
  const out: import('./types').TeamSeries = {};
  for (const r of data) {
    (out[r.model_version] ??= []).push([
      Math.floor(new Date(r.captured_at).getTime() / 1000),
      r4(r.p_advance), r4(r.p_win_cup), r4(r.p_sf),
    ]);
  }
  for (const m of Object.keys(out)) out[m] = dedupe(out[m]!);
  return out;
}

/** Last pre-kickoff prediction of every finished match scored per model
 * (multiclass Brier + log-loss) — computed here in dev; precomputed in snapshot mode. */
export async function getCalibration(): Promise<import('./types').Calibration> {
  const { data: finished, error: e1 } = await supa()
    .from('wc2026_match')
    .select('ss_id, start_ts, home_score, away_score')
    .eq('status_type', 'finished')
    .not('home_score', 'is', null);
  if (e1) throw e1;
  if (!finished?.length) return {};

  const byId = new Map(finished.map((m) => [m.ss_id as number, m]));
  const { data: hist, error: e2 } = await supa()
    .from('prediction_history')
    .select('match_id, model_version, captured_at, p_home, p_draw, p_away')
    .in('match_id', [...byId.keys()])
    .order('captured_at', { ascending: true });
  if (e2) throw e2;

  // last pre-kickoff row per (match, model)
  const last = new Map<string, (typeof hist)[number]>();
  for (const h of hist ?? []) {
    const m = byId.get(h.match_id)!;
    if (m.start_ts && h.captured_at <= m.start_ts) last.set(`${h.match_id}:${h.model_version}`, h);
  }

  const out: import('./types').Calibration = {};
  for (const h of last.values()) {
    const m = byId.get(h.match_id)!;
    const p: [number, number, number] = [r4(h.p_home), r4(h.p_draw), r4(h.p_away)];
    const outcome = m.home_score > m.away_score ? 0 : m.home_score < m.away_score ? 2 : 1;
    const brier = p.reduce((s, pi, i) => s + (pi - (i === outcome ? 1 : 0)) ** 2, 0);
    (out[h.model_version] ??= []).push({
      match_id: h.match_id,
      kickoff: m.start_ts,
      p,
      outcome,
      brier: Math.round(brier * 10000) / 10000,
      logloss: Math.round(-Math.log(Math.max(p[outcome], 1e-9)) * 10000) / 10000,
    });
  }
  for (const rows of Object.values(out)) rows.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  return out;
}

/** Per-team change in advance / title odds over the recent window (swing chart).
 * Mirrors exportMovers in the fetcher: latest snapshot vs the one nearest WINDOW_H
 * hours earlier (or the earliest snapshot when history is younger than the window). */
export async function getMovers(): Promise<import('./types').Movers | null> {
  const WINDOW_H = 24;
  const { data, error } = await supa()
    .from('simulation_history')
    .select('team_id, captured_at, p_advance, p_win_cup, p_sf, team:team_id(name, short_name, country_alpha2)')
    .eq('model_version', SIM_MODEL)
    .order('captured_at', { ascending: true });
  if (error) throw error;
  if (!data?.length) return null;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rows = data as any[];
  const tNow = rows[rows.length - 1].captured_at as string;
  const tRefTarget = new Date(new Date(tNow).getTime() - WINDOW_H * 3600_000).toISOString();
  const earliest = rows[0].captured_at as string;
  const tRef = tRefTarget < earliest ? earliest : tRefTarget;

  const now = new Map<number, any>();
  const prev = new Map<number, any>();
  for (const r of rows) {
    now.set(r.team_id, r); // last write wins → latest
    if (r.captured_at <= tRef) prev.set(r.team_id, r); // last ≤ tRef → nearest before
  }

  const teams = [...now.values()].map((n) => {
    const p = prev.get(n.team_id);
    return {
      team_id: n.team_id,
      p_advance: n.p_advance,
      p_win_cup: n.p_win_cup,
      p_sf: n.p_sf,
      d_advance: (n.p_advance ?? 0) - (p?.p_advance ?? n.p_advance ?? 0),
      d_win_cup: (n.p_win_cup ?? 0) - (p?.p_win_cup ?? n.p_win_cup ?? 0),
      team: n.team,
    };
  });
  teams.sort((a, b) => (b.p_win_cup ?? 0) - (a.p_win_cup ?? 0));
  return { window_h: WINDOW_H, from: [...prev.values()][0]?.captured_at ?? null, to: tNow, teams };
}

/** Detail for a single historical event (from team_match raw). Reconstructs home/away. */
export async function getEventDetail(eventId: number): Promise<import('./types').EventDetail | null> {
  const { data, error } = await supa()
    .from('team_match')
    .select(
      'event_id, start_ts, is_home, team_score, opponent_score, opponent_name, opponent_alpha2, tournament_name, status_type, raw, team:team_id(name, country_alpha2)',
    )
    .eq('event_id', eventId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const d = data as any;
  const tracked = { name: d.team?.name ?? null, alpha2: d.team?.country_alpha2 ?? null, score: d.team_score };
  const opp = { name: d.opponent_name ?? null, alpha2: d.opponent_alpha2 ?? null, score: d.opponent_score };
  const raw = d.raw ?? {};
  return {
    event_id: d.event_id,
    start_ts: d.start_ts,
    competition: d.tournament_name ?? raw?.tournament?.name ?? null,
    round: raw?.roundInfo?.name ?? (raw?.roundInfo?.round ? `Round ${raw.roundInfo.round}` : null),
    status_type: d.status_type,
    home: d.is_home ? tracked : opp,
    away: d.is_home ? opp : tracked,
  };
}
