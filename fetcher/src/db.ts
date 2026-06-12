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
    [
      t.ss_id,
      t.slug ?? null,
      t.name ?? null,
      t.category_id ?? null,
      t.category_slug ?? null,
      t.raw ?? null,
    ],
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

export interface SimulationRow {
  season_id: number;
  team_id: number;
  model_version: string;
  iterations?: number | null;
  exp_group_points?: number | null;
  p_win_group?: number | null;
  p_runner_up?: number | null;
  p_third?: number | null;
  p_advance?: number | null;
  p_r16?: number | null;
  p_qf?: number | null;
  p_sf?: number | null;
  p_final?: number | null;
  p_win_cup?: number | null;
}

export async function upsertSimulation(s: SimulationRow): Promise<void> {
  await dbQuery(
    `insert into public.tournament_simulation
       (season_id, team_id, model_version, iterations, exp_group_points,
        p_win_group, p_runner_up, p_third, p_advance,
        p_r16, p_qf, p_sf, p_final, p_win_cup, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     on conflict (season_id, team_id, model_version) do update set
       iterations=excluded.iterations, exp_group_points=excluded.exp_group_points,
       p_win_group=excluded.p_win_group, p_runner_up=excluded.p_runner_up,
       p_third=excluded.p_third, p_advance=excluded.p_advance,
       p_r16=excluded.p_r16, p_qf=excluded.p_qf, p_sf=excluded.p_sf,
       p_final=excluded.p_final, p_win_cup=excluded.p_win_cup, updated_at=now()`,
    [
      s.season_id,
      s.team_id,
      s.model_version,
      s.iterations ?? null,
      s.exp_group_points ?? null,
      s.p_win_group ?? null,
      s.p_runner_up ?? null,
      s.p_third ?? null,
      s.p_advance ?? null,
      s.p_r16 ?? null,
      s.p_qf ?? null,
      s.p_sf ?? null,
      s.p_final ?? null,
      s.p_win_cup ?? null,
    ],
  );
}

/* ── per-match enrichment (statistics / lineups / odds / votes / shotmap) ──
 * One row per match, upserted; status_at_fetch tells the enrich job whether the
 * stored payload is final ('finished') or still worth refetching. */

export interface MatchStatisticsRow {
  match_id: number;
  status_at_fetch?: string | null;
  xg_home?: number | null;
  xg_away?: number | null;
  possession_home?: number | null;
  possession_away?: number | null;
  shots_home?: number | null;
  shots_away?: number | null;
  shots_on_home?: number | null;
  shots_on_away?: number | null;
  raw?: unknown;
}

export async function upsertMatchStatistics(s: MatchStatisticsRow): Promise<void> {
  await dbQuery(
    `insert into public.match_statistics
       (match_id, status_at_fetch, xg_home, xg_away, possession_home, possession_away,
        shots_home, shots_away, shots_on_home, shots_on_away, raw, fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     on conflict (match_id) do update set
       status_at_fetch=excluded.status_at_fetch,
       xg_home=excluded.xg_home, xg_away=excluded.xg_away,
       possession_home=excluded.possession_home, possession_away=excluded.possession_away,
       shots_home=excluded.shots_home, shots_away=excluded.shots_away,
       shots_on_home=excluded.shots_on_home, shots_on_away=excluded.shots_on_away,
       raw=excluded.raw, fetched_at=now()`,
    [
      s.match_id,
      s.status_at_fetch ?? null,
      s.xg_home ?? null,
      s.xg_away ?? null,
      s.possession_home ?? null,
      s.possession_away ?? null,
      s.shots_home ?? null,
      s.shots_away ?? null,
      s.shots_on_home ?? null,
      s.shots_on_away ?? null,
      s.raw ?? null,
    ],
  );
}

export interface MatchLineupsRow {
  match_id: number;
  status_at_fetch?: string | null;
  confirmed?: boolean | null;
  home_formation?: string | null;
  away_formation?: string | null;
  home_missing?: unknown;
  away_missing?: unknown;
  raw?: unknown;
}

export async function upsertMatchLineups(l: MatchLineupsRow): Promise<void> {
  await dbQuery(
    `insert into public.match_lineups
       (match_id, status_at_fetch, confirmed, home_formation, away_formation,
        home_missing, away_missing, raw, fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (match_id) do update set
       status_at_fetch=excluded.status_at_fetch, confirmed=excluded.confirmed,
       home_formation=excluded.home_formation, away_formation=excluded.away_formation,
       home_missing=excluded.home_missing, away_missing=excluded.away_missing,
       raw=excluded.raw, fetched_at=now()`,
    [
      l.match_id,
      l.status_at_fetch ?? null,
      l.confirmed ?? null,
      l.home_formation ?? null,
      l.away_formation ?? null,
      l.home_missing ?? null,
      l.away_missing ?? null,
      l.raw ?? null,
    ],
  );
}

export interface MatchOddsRow {
  match_id: number;
  status_at_fetch?: string | null;
  imp_home?: number | null;
  imp_draw?: number | null;
  imp_away?: number | null;
  raw?: unknown;
}

export async function upsertMatchOdds(o: MatchOddsRow): Promise<void> {
  await dbQuery(
    `insert into public.match_odds
       (match_id, status_at_fetch, imp_home, imp_draw, imp_away, raw, fetched_at)
     values ($1,$2,$3,$4,$5,$6, now())
     on conflict (match_id) do update set
       status_at_fetch=excluded.status_at_fetch,
       imp_home=excluded.imp_home, imp_draw=excluded.imp_draw, imp_away=excluded.imp_away,
       raw=excluded.raw, fetched_at=now()`,
    [o.match_id, o.status_at_fetch ?? null, o.imp_home ?? null, o.imp_draw ?? null, o.imp_away ?? null, o.raw ?? null],
  );
}

export interface MatchVotesRow {
  match_id: number;
  status_at_fetch?: string | null;
  votes_home?: number | null;
  votes_draw?: number | null;
  votes_away?: number | null;
  raw?: unknown;
}

export async function upsertMatchVotes(v: MatchVotesRow): Promise<void> {
  await dbQuery(
    `insert into public.match_votes
       (match_id, status_at_fetch, votes_home, votes_draw, votes_away, raw, fetched_at)
     values ($1,$2,$3,$4,$5,$6, now())
     on conflict (match_id) do update set
       status_at_fetch=excluded.status_at_fetch,
       votes_home=excluded.votes_home, votes_draw=excluded.votes_draw, votes_away=excluded.votes_away,
       raw=excluded.raw, fetched_at=now()`,
    [v.match_id, v.status_at_fetch ?? null, v.votes_home ?? null, v.votes_draw ?? null, v.votes_away ?? null, v.raw ?? null],
  );
}

export async function upsertMatchShotmap(matchId: number, statusAtFetch: string | null, raw: unknown): Promise<void> {
  await dbQuery(
    `insert into public.match_shotmap (match_id, status_at_fetch, raw, fetched_at)
     values ($1,$2,$3, now())
     on conflict (match_id) do update set
       status_at_fetch=excluded.status_at_fetch, raw=excluded.raw, fetched_at=now()`,
    [matchId, statusAtFetch, raw ?? null],
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
