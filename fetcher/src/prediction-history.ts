import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, dbQuery } from './db.ts';

/**
 * Prediction time series — `prediction` and `tournament_simulation` are upserted
 * ("latest only"), so the chronology of how probabilities evolve lives in the
 * append-only history tables (migration 20260611130000). Two modes:
 *
 *   record    copy the current prediction/tournament_simulation rows into the
 *             history tables (captured_at = now). Runs every hourly pipeline tick
 *             (scripts/hourly-snapshot.sh) right after predict/simulate, so the
 *             local DB keeps the full series from here on. Only pre-kickoff
 *             predictions are recorded — the series is "how the forecast moved
 *             until the whistle", not what a stale model says about a played game.
 *
 *   backfill  one-off catch-up for the period before `record` existed: download
 *             the archived full snapshots from R2 (keys read from the launchd log
 *             or passed as args) and insert their predictions/simulations with
 *             captured_at = the snapshot's generated_at. Idempotent — the unique
 *             (id, model_version, captured_at) keys make duplicate runs no-ops.
 */

const R2_BUCKET = process.env.CF_R2_BUCKET ?? 'pediludium-snapshots';
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? '7dc7167b7e2e00923bfa7cd697df14e4'; // D.O.M.
const LAUNCHD_LOG = path.join(homedir(), 'Library', 'Logs', 'pediludium', 'snapshot.log');

async function record(): Promise<void> {
  const capturedAt = new Date().toISOString();

  await dbQuery(
    `insert into public.prediction_history
       (match_id, model_version, captured_at, p_home, p_draw, p_away, exp_home_goals, exp_away_goals)
     select p.match_id, p.model_version, $1, p.p_home, p.p_draw, p.p_away, p.exp_home_goals, p.exp_away_goals
       from public.prediction p
       join public.match m on m.ss_id = p.match_id
      where m.status_type = 'notstarted'
     on conflict do nothing`,
    [capturedAt],
  );

  await dbQuery(
    `insert into public.simulation_history
       (season_id, team_id, model_version, captured_at,
        exp_group_points, p_win_group, p_advance, p_sf, p_final, p_win_cup)
     select s.season_id, s.team_id, s.model_version, $1,
            s.exp_group_points, s.p_win_group, s.p_advance, s.p_sf, s.p_final, s.p_win_cup
       from public.tournament_simulation s
     on conflict do nothing`,
    [capturedAt],
  );

  const counts = await dbQuery<{ np: string; ns: string }>(
    `select (select count(*) from public.prediction_history where captured_at = $1)::text as np,
            (select count(*) from public.simulation_history where captured_at = $1)::text as ns`,
    [capturedAt],
  );
  console.log(
    `[history] record @ ${capturedAt}: ${counts[0]?.np ?? '?'} predictions, ${counts[0]?.ns ?? '?'} simulations`,
  );
}

/* ── backfill from R2 archives ──────────────────────────────────────── */

interface SnapMatch {
  ss_id: number;
  status_type: string | null;
}
interface SnapPrediction {
  match_id: number;
  model_version: string;
  p_home: number | null;
  p_draw: number | null;
  p_away: number | null;
  exp_home_goals: number | null;
  exp_away_goals: number | null;
}
interface SnapSim {
  team_id: number;
  exp_group_points: number | null;
  p_win_group: number | null;
  p_advance: number | null;
  p_sf: number | null;
  p_final: number | null;
  p_win_cup: number | null;
}
interface SnapCore {
  generated_at: string;
  season_id: number;
  matches: SnapMatch[];
  predictions: Record<string, SnapPrediction[]>;
  simulations: Record<string, SnapSim[]>;
}

async function logArchiveKeys(): Promise<string[]> {
  if (!existsSync(LAUNCHD_LOG)) return [];
  const log = await readFile(LAUNCHD_LOG, 'utf8');
  return [...new Set(log.match(/snapshots\/[0-9TZ.-]+\.json/g) ?? [])].sort();
}

function r2Get(key: string, outFile: string): void {
  const res = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'get', `${R2_BUCKET}/${key}`, `--file=${outFile}`, '--remote'],
    { cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID } },
  );
  if (res.status !== 0) throw new Error(`wrangler r2 get ${key} failed (exit ${res.status})`);
}

async function ingestSnapshot(core: SnapCore): Promise<{ np: number; ns: number }> {
  const capturedAt = core.generated_at;
  const notStarted = new Set(
    core.matches.filter((m) => m.status_type === 'notstarted').map((m) => m.ss_id),
  );

  let np = 0;
  for (const [model, rows] of Object.entries(core.predictions ?? {})) {
    const keep = rows.filter((p) => notStarted.has(p.match_id));
    if (keep.length === 0) continue;
    const res = await dbQuery<{ inserted: number }>(
      `insert into public.prediction_history
         (match_id, model_version, captured_at, p_home, p_draw, p_away, exp_home_goals, exp_away_goals)
       select u.match_id, $2, $3, u.p_home, u.p_draw, u.p_away, u.ehg, u.eag
         from unnest($1::jsonb[]) as raw(j),
              lateral jsonb_to_record(raw.j)
                as u(match_id bigint, p_home float8, p_draw float8, p_away float8, ehg float8, eag float8)
       on conflict do nothing
       returning 1 as inserted`,
      [
        keep.map((p) =>
          JSON.stringify({
            match_id: p.match_id, p_home: p.p_home, p_draw: p.p_draw, p_away: p.p_away,
            ehg: p.exp_home_goals, eag: p.exp_away_goals,
          }),
        ),
        model,
        capturedAt,
      ],
    );
    np += res.length;
  }

  let ns = 0;
  for (const [model, rows] of Object.entries(core.simulations ?? {})) {
    if (rows.length === 0) continue;
    const res = await dbQuery<{ inserted: number }>(
      `insert into public.simulation_history
         (season_id, team_id, model_version, captured_at,
          exp_group_points, p_win_group, p_advance, p_sf, p_final, p_win_cup)
       select $4, u.team_id, $2, $3, u.egp, u.pwg, u.padv, u.psf, u.pfin, u.pcup
         from unnest($1::jsonb[]) as raw(j),
              lateral jsonb_to_record(raw.j)
                as u(team_id bigint, egp float8, pwg float8, padv float8, psf float8, pfin float8, pcup float8)
       on conflict do nothing
       returning 1 as inserted`,
      [
        rows.map((s) =>
          JSON.stringify({
            team_id: s.team_id, egp: s.exp_group_points, pwg: s.p_win_group,
            padv: s.p_advance, psf: s.p_sf, pfin: s.p_final, pcup: s.p_win_cup,
          }),
        ),
        model,
        capturedAt,
        core.season_id,
      ],
    );
    ns += res.length;
  }
  return { np, ns };
}

async function backfill(keys: string[]): Promise<void> {
  if (keys.length === 0) keys = await logArchiveKeys();
  if (keys.length === 0) {
    console.log('[history] backfill: no archive keys (pass them as args or check the launchd log)');
    return;
  }

  // skip snapshots already ingested (their generated_at is a captured_at in the table)
  const have = new Set(
    (
      await dbQuery<{ ts: string }>(
        `select distinct to_char(captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24-MI-SS.MS"Z"') as ts
           from public.prediction_history`,
      )
    ).map((r) => r.ts),
  );
  const todo = keys.filter((k) => !have.has(k.replace(/^snapshots\//, '').replace(/\.json$/, '')));
  console.log(`[history] backfill: ${keys.length} archives, ${todo.length} to ingest`);

  const tmp = path.join(tmpdir(), 'pediludium-backfill.json');
  for (const key of todo) {
    r2Get(key, tmp);
    const core = (JSON.parse(await readFile(tmp, 'utf8')) as { core: SnapCore }).core;
    const { np, ns } = await ingestSnapshot(core);
    console.log(`[history]   ${key} (@ ${core.generated_at}): +${np} predictions, +${ns} simulations`);
  }
  await rm(tmp, { force: true });
}

const mode = process.argv[2];
const run =
  mode === 'record' ? record() :
  mode === 'backfill' ? backfill(process.argv.slice(3)) :
  Promise.reject(new Error(`usage: prediction-history.ts <record|backfill> [r2-keys...]`));

run
  .catch((err) => {
    console.error('[history] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
