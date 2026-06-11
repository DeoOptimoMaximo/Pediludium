import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, dbQuery } from './db.ts';
import { WORLD_CUP } from './config.ts';

/**
 * Snapshot exporter — dumps every query the web app runs (web/lib/data.ts) into JSON
 * artifacts for the public Cloudflare deployment (nogomet.domovina.ai). The live site
 * reads ONLY these snapshots (Workers KV); Supabase stays local-dev-only.
 *
 * All aggregation happens in SQL via json_agg/json_build_object so bigint ids arrive
 * as JSON numbers (node-postgres would otherwise stringify them).
 *
 * Outputs (under fetcher/snapshot/):
 *   - kv-bulk.json   → desired KV state: key `core` (matches, predictions, standings,
 *                      ratings, sims, teams) + `hist:{teamId}` + `evs:{shard}` (events are
 *                      sharded by event_id % EVENT_SHARDS — per-event keys would cost
 *                      thousands of KV writes per publish; publish-snapshot.ts uploads
 *                      only keys whose value changed since the last publish)
 *   - snapshot.json  → the same data in one file, archived per-run to R2 (timestamped),
 *                      which doubles as the prediction-calibration history.
 */

export const EVENT_SHARDS = 64;
// time-series shards (mser:{match_id % MSER_SHARDS}) — mirror in web/lib/data-snapshot.ts
export const MSER_SHARDS = 16;

const OUT_DIR = path.resolve(import.meta.dirname, '..', 'snapshot');

/** Run a query that returns a single json column aliased `j` and return it parsed. */
async function jsonOne<T>(sql: string): Promise<T> {
  const rows = await dbQuery<{ j: T }>(sql);
  if (!rows[0]) throw new Error('json query returned no row');
  return rows[0].j;
}

async function exportCore(generatedAt: string) {
  // explicit column list: the view exposes m.* incl. the bulky raw jsonb — keep only WcMatch fields
  const matches = await jsonOne(
    `select coalesce(json_agg(json_build_object(
              'ss_id', m.ss_id, 'season_id', m.season_id,
              'home_team_id', m.home_team_id, 'away_team_id', m.away_team_id,
              'start_ts', m.start_ts, 'status_type', m.status_type, 'status_code', m.status_code,
              'winner_code', m.winner_code, 'home_score', m.home_score, 'away_score', m.away_score,
              'round', m.round, 'round_name', m.round_name, 'group_name', m.group_name,
              'home_name', m.home_name, 'home_short', m.home_short, 'home_alpha2', m.home_alpha2,
              'away_name', m.away_name, 'away_short', m.away_short, 'away_alpha2', m.away_alpha2
            ) order by m.start_ts), '[]'::json) as j
       from public.wc2026_match m`,
  );

  const predictions = await jsonOne(
    `select coalesce(json_object_agg(model_version, preds), '{}'::json) as j
       from (
         select model_version,
                json_agg(json_build_object(
                  'match_id', match_id, 'model_version', model_version,
                  'p_home', p_home, 'p_draw', p_draw, 'p_away', p_away,
                  'exp_home_goals', exp_home_goals, 'exp_away_goals', exp_away_goals)) as preds
           from public.prediction
          group by model_version
       ) s`,
  );

  const simulations = await jsonOne(
    `select coalesce(json_object_agg(model_version, sims), '{}'::json) as j
       from (
         select s.model_version,
                json_agg(json_build_object(
                  'team_id', s.team_id, 'iterations', s.iterations,
                  'exp_group_points', s.exp_group_points,
                  'p_win_group', s.p_win_group, 'p_runner_up', s.p_runner_up,
                  'p_third', s.p_third, 'p_advance', s.p_advance,
                  'p_r16', s.p_r16, 'p_qf', s.p_qf, 'p_sf', s.p_sf,
                  'p_final', s.p_final, 'p_win_cup', s.p_win_cup,
                  'team', json_build_object('name', t.name, 'short_name', t.short_name,
                                            'country_alpha2', t.country_alpha2)
                ) order by s.p_win_cup desc) as sims
           from public.tournament_simulation s
           left join public.team t on t.ss_id = s.team_id
          group by s.model_version
       ) x`,
  );

  const standings = await jsonOne(
    `select coalesce(json_agg(json_build_object(
              'season_id', s.season_id, 'group_name', s.group_name, 'team_id', s.team_id,
              'position', s.position, 'played', s.played, 'wins', s.wins, 'draws', s.draws,
              'losses', s.losses, 'goals_for', s.goals_for, 'goals_against', s.goals_against,
              'points', s.points,
              'team', json_build_object('name', t.name, 'short_name', t.short_name,
                                        'country_alpha2', t.country_alpha2)
            ) order by s.group_name, s.position), '[]'::json) as j
       from public.standing s
       left join public.team t on t.ss_id = s.team_id`,
  );

  // latest elo per team, highest first (mirrors getRatings' in-JS dedup)
  const ratings = await jsonOne(
    `select coalesce(json_agg(json_build_object(
              'team_id', r.team_id, 'rating', r.rating,
              'team', json_build_object('name', t.name, 'short_name', t.short_name,
                                        'country_alpha2', t.country_alpha2)
            ) order by r.rating desc), '[]'::json) as j
       from (select distinct on (team_id) team_id, rating
               from public.team_rating where model = 'elo'
              order by team_id, as_of desc) r
       left join public.team t on t.ss_id = r.team_id`,
  );

  // mirrors getNationalTeams (rating merged, rating desc nulls-as-0, then name)
  const nationalTeams = await jsonOne(
    `select coalesce(json_agg(json_build_object(
              'ss_id', t.ss_id, 'name', t.name, 'short_name', t.short_name,
              'country_alpha2', t.country_alpha2, 'is_national', t.is_national,
              'rating', r.rating
            ) order by coalesce(r.rating, 0) desc, t.name), '[]'::json) as j
       from public.team t
       left join (select distinct on (team_id) team_id, rating
                    from public.team_rating where model = 'elo'
                   order by team_id, as_of desc) r on r.team_id = t.ss_id
      where t.is_national = true`,
  );

  // every team (national + club opponents) for getTeamInfo lookups, keyed by ss_id
  const teams = await jsonOne(
    `select coalesce(json_object_agg(ss_id, json_build_object(
              'ss_id', ss_id, 'name', name, 'short_name', short_name,
              'country_alpha2', country_alpha2, 'is_national', is_national)), '{}'::json) as j
       from public.team`,
  );

  return {
    generated_at: generatedAt,
    season_id: WORLD_CUP.seasonId2026,
    matches,
    predictions,
    simulations,
    standings,
    ratings,
    national_teams: nationalTeams,
    teams,
  };
}

/** Per-team history (mirrors getTeamHistory: newest first). */
async function exportHistories(): Promise<Record<string, unknown>> {
  const rows = await dbQuery<{ team_id: number; j: unknown }>(
    `select team_id,
            json_agg(json_build_object(
              'event_id', event_id, 'start_ts', start_ts, 'is_home', is_home,
              'opponent_id', opponent_id, 'opponent_name', opponent_name,
              'opponent_alpha2', opponent_alpha2, 'team_score', team_score,
              'opponent_score', opponent_score, 'result', result,
              'tournament_name', tournament_name, 'season_year', season_year
            ) order by start_ts desc) as j
       from public.team_match
      group by team_id`,
  );
  return Object.fromEntries(rows.map((r) => [String(r.team_id), r.j]));
}

/** Precomputed EventDetail per event (mirrors getEventDetail's home/away reconstruction). */
async function exportEvents(): Promise<Record<string, unknown>> {
  const rows = await dbQuery<{ event_id: number; j: unknown }>(
    `select e.event_id,
            json_build_object(
              'event_id', e.event_id,
              'start_ts', e.start_ts,
              'competition', coalesce(e.tournament_name, e.raw->'tournament'->>'name'),
              'round', coalesce(e.raw->'roundInfo'->>'name',
                                case when e.raw->'roundInfo'->>'round' is not null
                                     then 'Round ' || (e.raw->'roundInfo'->>'round') end),
              'status_type', e.status_type,
              'home', case when e.is_home
                           then json_build_object('name', t.name, 'alpha2', t.country_alpha2, 'score', e.team_score)
                           else json_build_object('name', e.opponent_name, 'alpha2', e.opponent_alpha2, 'score', e.opponent_score) end,
              'away', case when e.is_home
                           then json_build_object('name', e.opponent_name, 'alpha2', e.opponent_alpha2, 'score', e.opponent_score)
                           else json_build_object('name', t.name, 'alpha2', t.country_alpha2, 'score', e.team_score) end
            ) as j
       from (select distinct on (event_id) * from public.team_match order by event_id) e
       left join public.team t on t.ss_id = e.team_id`,
  );
  return Object.fromEntries(rows.map((r) => [String(r.event_id), r.j]));
}

/* ── prediction/simulation time series (from the append-only history tables) ──
 * Compact points: [epoch_seconds, ...probs rounded to 4dp]. Consecutive identical
 * prob vectors are collapsed (hourly refits often barely move), so a series only
 * grows when the model actually changed its mind. */

type SeriesPt = number[];

function dedupe(points: SeriesPt[]): SeriesPt[] {
  const out: SeriesPt[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev.length === p.length && prev.every((v, i) => i === 0 || v === p[i])) continue;
    out.push(p);
  }
  return out;
}

/** match_id → model_version → [[t, p_home, p_draw, p_away], …] sharded for KV. */
async function exportMatchSeries(): Promise<Record<number, Record<string, Record<string, SeriesPt[]>>>> {
  const rows = await dbQuery<{ match_id: number; model_version: string; pts: SeriesPt[] }>(
    `select match_id, model_version,
            json_agg(json_build_array(
              floor(extract(epoch from captured_at)),
              round(p_home::numeric, 4), round(p_draw::numeric, 4), round(p_away::numeric, 4)
            ) order by captured_at) as pts
       from public.prediction_history
      group by match_id, model_version`,
  );
  const shards: Record<number, Record<string, Record<string, SeriesPt[]>>> = {};
  for (let s = 0; s < MSER_SHARDS; s++) shards[s] = {};
  for (const r of rows) {
    const shard = shards[r.match_id % MSER_SHARDS]!;
    ((shard[String(r.match_id)] ??= {}) as Record<string, SeriesPt[]>)[r.model_version] = dedupe(r.pts);
  }
  return shards;
}

/** team_id → model_version → [[t, p_advance, p_win_cup, p_sf], …]. */
async function exportTeamSeries(): Promise<Record<string, Record<string, SeriesPt[]>>> {
  const rows = await dbQuery<{ team_id: number; model_version: string; pts: SeriesPt[] }>(
    `select team_id, model_version,
            json_agg(json_build_array(
              floor(extract(epoch from captured_at)),
              round(p_advance::numeric, 4), round(p_win_cup::numeric, 4), round(p_sf::numeric, 4)
            ) order by captured_at) as pts
       from public.simulation_history
      group by team_id, model_version`,
  );
  const out: Record<string, Record<string, SeriesPt[]>> = {};
  for (const r of rows) {
    (out[String(r.team_id)] ??= {})[r.model_version] = dedupe(r.pts);
  }
  return out;
}

/** Per finished match & model: the last pre-kickoff prediction scored against the
 * actual result (multiclass Brier + log-loss). The web only aggregates/renders. */
async function exportCalibration(): Promise<Record<string, unknown[]>> {
  const rows = await dbQuery<{
    model_version: string;
    match_id: number;
    start_ts: string;
    home_score: number;
    away_score: number;
    p_home: number | null;
    p_draw: number | null;
    p_away: number | null;
  }>(
    `select distinct on (h.match_id, h.model_version)
            h.model_version, h.match_id, m.start_ts, m.home_score, m.away_score,
            h.p_home, h.p_draw, h.p_away
       from public.prediction_history h
       join public.match m on m.ss_id = h.match_id
      where m.status_type = 'finished'
        and m.home_score is not null and m.away_score is not null
        and h.captured_at <= m.start_ts
      order by h.match_id, h.model_version, h.captured_at desc`,
  );
  const out: Record<string, unknown[]> = {};
  for (const r of rows) {
    const p = [r.p_home ?? 0, r.p_draw ?? 0, r.p_away ?? 0];
    const outcome = r.home_score > r.away_score ? 0 : r.home_score < r.away_score ? 2 : 1;
    const brier = p.reduce((s, pi, i) => s + (pi - (i === outcome ? 1 : 0)) ** 2, 0);
    const logloss = -Math.log(Math.max(p[outcome]!, 1e-9));
    (out[r.model_version] ??= []).push({
      match_id: r.match_id,
      kickoff: r.start_ts,
      p: p.map((v) => Math.round(v * 10000) / 10000),
      outcome,
      brier: Math.round(brier * 10000) / 10000,
      logloss: Math.round(logloss * 10000) / 10000,
    });
  }
  for (const rowsOf of Object.values(out)) {
    (rowsOf as { kickoff: string }[]).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  }
  return out;
}

async function main(): Promise<void> {
  const generatedAt = new Date().toISOString();
  const core = await exportCore(generatedAt);
  const histories = await exportHistories();
  const events = await exportEvents();
  const matchSeries = await exportMatchSeries();
  const teamSeries = await exportTeamSeries();
  const calibration = await exportCalibration();

  const shards: Record<number, Record<string, unknown>> = {};
  for (const [id, j] of Object.entries(events)) {
    const s = Number(id) % EVENT_SHARDS;
    (shards[s] ??= {})[id] = j;
  }

  const kvBulk = [
    { key: 'core', value: JSON.stringify(core) },
    ...Object.entries(histories).map(([id, j]) => ({ key: `hist:${id}`, value: JSON.stringify(j) })),
    ...Object.entries(shards).map(([s, j]) => ({ key: `evs:${s}`, value: JSON.stringify(j) })),
    ...Object.entries(matchSeries).map(([s, j]) => ({ key: `mser:${s}`, value: JSON.stringify(j) })),
    ...Object.entries(teamSeries).map(([id, j]) => ({ key: `tser:${id}`, value: JSON.stringify(j) })),
    { key: 'calib', value: JSON.stringify(calibration) },
  ];

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, 'kv-bulk.json'), JSON.stringify(kvBulk));
  await writeFile(
    path.join(OUT_DIR, 'snapshot.json'),
    JSON.stringify({ core, histories, events }),
  );

  const sizeMb = (n: number) => (n / 1024 / 1024).toFixed(2);
  const coreBytes = Buffer.byteLength(kvBulk[0]!.value);
  const totalBytes = kvBulk.reduce((s, e) => s + Buffer.byteLength(e.value), 0);
  console.log(
    `[export] core ${sizeMb(coreBytes)} MB, ${Object.keys(histories).length} histories, ` +
      `${Object.keys(events).length} events, ${kvBulk.length} KV keys, ${sizeMb(totalBytes)} MB total → ${OUT_DIR}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('[export] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
