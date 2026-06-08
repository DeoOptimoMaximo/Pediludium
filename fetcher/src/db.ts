import pg from 'pg';
import { config } from './config.ts';

/**
 * DB writer — upserts SofaScore data into Supabase Postgres by ss_id (raw + parsed).
 * Direct Postgres connection (local service-role equivalent; bypasses RLS).
 * The fetcher is the ONLY writer (docs/04 golden rule).
 */

const pool = new pg.Pool({ connectionString: config.dbUrl, max: 4 });

export async function dbQuery<T = unknown>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export interface TournamentRow {
  ss_id: number;
  slug?: string | null;
  name?: string | null;
  category_id?: number | null;
  category_slug?: string | null;
  raw?: unknown;
}

export async function upsertTournament(t: TournamentRow): Promise<void> {
  await dbQuery(
    `insert into public.tournament (ss_id, slug, name, category_id, category_slug, raw, fetched_at)
     values ($1,$2,$3,$4,$5,$6, now())
     on conflict (ss_id) do update set
       slug=excluded.slug, name=excluded.name, category_id=excluded.category_id,
       category_slug=excluded.category_slug, raw=excluded.raw, fetched_at=now()`,
    [t.ss_id, t.slug ?? null, t.name ?? null, t.category_id ?? null, t.category_slug ?? null, t.raw ?? null],
  );
}

export interface SeasonRow {
  ss_id: number;
  tournament_id: number;
  year?: string | null;
  name?: string | null;
  raw?: unknown;
}

export async function upsertSeason(s: SeasonRow): Promise<void> {
  await dbQuery(
    `insert into public.season (ss_id, tournament_id, year, name, raw, fetched_at)
     values ($1,$2,$3,$4,$5, now())
     on conflict (ss_id) do update set
       tournament_id=excluded.tournament_id, year=excluded.year, name=excluded.name,
       raw=excluded.raw, fetched_at=now()`,
    [s.ss_id, s.tournament_id, s.year ?? null, s.name ?? null, s.raw ?? null],
  );
}

export interface TeamRow {
  ss_id: number;
  slug?: string | null;
  name?: string | null;
  short_name?: string | null;
  country_alpha2?: string | null;
  is_national?: boolean;
  raw?: unknown;
}

export async function upsertTeam(t: TeamRow): Promise<void> {
  await dbQuery(
    `insert into public.team (ss_id, slug, name, short_name, country_alpha2, is_national, raw, fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (ss_id) do update set
       slug=excluded.slug, name=excluded.name, short_name=excluded.short_name,
       country_alpha2=excluded.country_alpha2, is_national=excluded.is_national,
       raw=excluded.raw, fetched_at=now()`,
    [
      t.ss_id,
      t.slug ?? null,
      t.name ?? null,
      t.short_name ?? null,
      t.country_alpha2 ?? null,
      t.is_national ?? false,
      t.raw ?? null,
    ],
  );
}

export interface MatchRow {
  ss_id: number;
  tournament_id?: number | null;
  season_id?: number | null;
  home_team_id?: number | null;
  away_team_id?: number | null;
  start_ts?: string | null; // ISO
  status_type?: string | null;
  status_code?: number | null;
  winner_code?: number | null;
  home_score?: number | null;
  away_score?: number | null;
  home_score_ht?: number | null;
  away_score_ht?: number | null;
  round?: number | null;
  round_name?: string | null;
  group_name?: string | null;
  raw?: unknown;
}

export async function upsertMatch(m: MatchRow): Promise<void> {
  await dbQuery(
    `insert into public.match
       (ss_id, tournament_id, season_id, home_team_id, away_team_id, start_ts,
        status_type, status_code, winner_code, home_score, away_score,
        home_score_ht, away_score_ht, round, round_name, group_name, raw, fetched_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now(), now())
     on conflict (ss_id) do update set
       tournament_id=excluded.tournament_id, season_id=excluded.season_id,
       home_team_id=excluded.home_team_id, away_team_id=excluded.away_team_id,
       start_ts=excluded.start_ts, status_type=excluded.status_type, status_code=excluded.status_code,
       winner_code=excluded.winner_code, home_score=excluded.home_score, away_score=excluded.away_score,
       home_score_ht=excluded.home_score_ht, away_score_ht=excluded.away_score_ht,
       round=excluded.round, round_name=excluded.round_name,
       group_name=coalesce(excluded.group_name, match.group_name),
       raw=excluded.raw, fetched_at=now()`,
    [
      m.ss_id,
      m.tournament_id ?? null,
      m.season_id ?? null,
      m.home_team_id ?? null,
      m.away_team_id ?? null,
      m.start_ts ?? null,
      m.status_type ?? null,
      m.status_code ?? null,
      m.winner_code ?? null,
      m.home_score ?? null,
      m.away_score ?? null,
      m.home_score_ht ?? null,
      m.away_score_ht ?? null,
      m.round ?? null,
      m.round_name ?? null,
      m.group_name ?? null,
      m.raw ?? null,
    ],
  );
}

export async function setMatchGroup(matchId: number, groupName: string): Promise<void> {
  await dbQuery(`update public.match set group_name=$2 where ss_id=$1`, [matchId, groupName]);
}

export interface StandingRow {
  season_id: number;
  group_name?: string | null;
  team_id?: number | null;
  position?: number | null;
  played?: number | null;
  wins?: number | null;
  draws?: number | null;
  losses?: number | null;
  goals_for?: number | null;
  goals_against?: number | null;
  points?: number | null;
  raw?: unknown;
}

export async function upsertStanding(s: StandingRow): Promise<void> {
  await dbQuery(
    `insert into public.standing
       (season_id, group_name, team_id, position, played, wins, draws, losses,
        goals_for, goals_against, points, raw, fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     on conflict (season_id, group_name, team_id) do update set
       position=excluded.position, played=excluded.played, wins=excluded.wins,
       draws=excluded.draws, losses=excluded.losses, goals_for=excluded.goals_for,
       goals_against=excluded.goals_against, points=excluded.points, raw=excluded.raw, fetched_at=now()`,
    [
      s.season_id,
      s.group_name ?? null,
      s.team_id ?? null,
      s.position ?? null,
      s.played ?? null,
      s.wins ?? null,
      s.draws ?? null,
      s.losses ?? null,
      s.goals_for ?? null,
      s.goals_against ?? null,
      s.points ?? null,
      s.raw ?? null,
    ],
  );
}

export interface PredictionRow {
  match_id: number;
  model_version: string;
  p_home?: number | null;
  p_draw?: number | null;
  p_away?: number | null;
  exp_home_goals?: number | null;
  exp_away_goals?: number | null;
}

export async function upsertPrediction(p: PredictionRow): Promise<void> {
  await dbQuery(
    `insert into public.prediction
       (match_id, model_version, p_home, p_draw, p_away, exp_home_goals, exp_away_goals, created_at)
     values ($1,$2,$3,$4,$5,$6,$7, now())
     on conflict (match_id, model_version) do update set
       p_home=excluded.p_home, p_draw=excluded.p_draw, p_away=excluded.p_away,
       exp_home_goals=excluded.exp_home_goals, exp_away_goals=excluded.exp_away_goals,
       created_at=now()`,
    [
      p.match_id,
      p.model_version,
      p.p_home ?? null,
      p.p_draw ?? null,
      p.p_away ?? null,
      p.exp_home_goals ?? null,
      p.exp_away_goals ?? null,
    ],
  );
}

export interface TeamMatchRow {
  team_id: number;
  event_id: number;
  start_ts?: string | null;
  is_home?: boolean | null;
  opponent_id?: number | null;
  opponent_name?: string | null;
  opponent_alpha2?: string | null;
  team_score?: number | null;
  opponent_score?: number | null;
  result?: 'W' | 'D' | 'L' | null;
  tournament_id?: number | null;
  tournament_name?: string | null;
  season_year?: string | null;
  status_type?: string | null;
  raw?: unknown;
}

export async function upsertTeamMatch(m: TeamMatchRow): Promise<void> {
  await dbQuery(
    `insert into public.team_match
       (team_id, event_id, start_ts, is_home, opponent_id, opponent_name, opponent_alpha2,
        team_score, opponent_score, result, tournament_id, tournament_name, season_year,
        status_type, raw, fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now())
     on conflict (team_id, event_id) do update set
       start_ts=excluded.start_ts, is_home=excluded.is_home, opponent_id=excluded.opponent_id,
       opponent_name=excluded.opponent_name, opponent_alpha2=excluded.opponent_alpha2,
       team_score=excluded.team_score, opponent_score=excluded.opponent_score, result=excluded.result,
       tournament_id=excluded.tournament_id, tournament_name=excluded.tournament_name,
       season_year=excluded.season_year, status_type=excluded.status_type, raw=excluded.raw,
       fetched_at=now()`,
    [
      m.team_id,
      m.event_id,
      m.start_ts ?? null,
      m.is_home ?? null,
      m.opponent_id ?? null,
      m.opponent_name ?? null,
      m.opponent_alpha2 ?? null,
      m.team_score ?? null,
      m.opponent_score ?? null,
      m.result ?? null,
      m.tournament_id ?? null,
      m.tournament_name ?? null,
      m.season_year ?? null,
      m.status_type ?? null,
      m.raw ?? null,
    ],
  );
}

export async function upsertTeamRating(
  teamId: number,
  model: string,
  rating: number,
  asOf: string,
): Promise<void> {
  await dbQuery(
    `insert into public.team_rating (team_id, model, rating, as_of)
     values ($1,$2,$3,$4)
     on conflict (team_id, model, as_of) do update set rating=excluded.rating`,
    [teamId, model, rating, asOf],
  );
}
