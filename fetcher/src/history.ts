import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.ts';
import { closeBrowser, getJson } from './browser.ts';
import { EventsResponseSchema } from './schemas.ts';
import { closeDb, dbQuery, upsertTeamMatch, type TeamMatchRow } from './db.ts';

/**
 * Fetch ~10 years of match history for every national team and store it per-team
 * (public.team_match) for the team history view. Real Chrome transport, politeness queue.
 * Paginates team/{id}/events/last/{page} back until the 10-year cutoff or no more pages.
 */

const YEARS = Number(process.env.SOFA_HISTORY_YEARS ?? '10');
const MAX_PAGES = Number(process.env.SOFA_HISTORY_MAX_PAGES ?? '30');

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

async function saveSample(name: string, payload: unknown): Promise<void> {
  const dir = join(config.sampleDir, 'team-history');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

function rowOf(teamId: number, e: AnyObj): TeamMatchRow | null {
  const isHome = e.homeTeam?.id === teamId;
  const opp = isHome ? e.awayTeam : e.homeTeam;
  const ts = isHome ? e.homeScore?.current : e.awayScore?.current;
  const os = isHome ? e.awayScore?.current : e.homeScore?.current;
  if (ts == null || os == null) return null; // not played / no score
  const result: 'W' | 'D' | 'L' = ts > os ? 'W' : ts === os ? 'D' : 'L';
  return {
    team_id: teamId,
    event_id: e.id,
    start_ts: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
    is_home: isHome,
    opponent_id: opp?.id ?? null,
    opponent_name: opp?.name ?? null,
    opponent_alpha2: opp?.country?.alpha2 ?? null,
    team_score: ts,
    opponent_score: os,
    result,
    tournament_id: e.tournament?.uniqueTournament?.id ?? e.tournament?.id ?? null,
    tournament_name: e.tournament?.name ?? e.tournament?.uniqueTournament?.name ?? null,
    season_year: e.season?.year ?? null,
    status_type: e.status?.type ?? null,
    raw: e,
  };
}

async function main(): Promise<void> {
  const cutoff = Date.now() / 1000 - YEARS * 365.25 * 24 * 3600;
  const teams = await dbQuery<{ ss_id: string; name: string }>(
    'select ss_id, name from public.team where is_national order by name',
  );
  console.log(`\n=== Pediludium history — last ${YEARS}y for ${teams.length} teams ===\n`);

  let grandTotal = 0;
  for (const t of teams) {
    const id = Number(t.ss_id);
    let teamCount = 0;
    let reachedCutoff = false;
    for (let page = 0; page < MAX_PAGES && !reachedCutoff; page++) {
      let data;
      let raw;
      try {
        ({ data, raw } = await getJson(`/team/${id}/events/last/${page}`, EventsResponseSchema));
      } catch (err) {
        if (page === 0) console.warn(`[history] ${t.name}: ${String(err).slice(0, 60)}`);
        break;
      }
      await saveSample(`${id}-${page}`, raw);
      const events = ((raw as AnyObj).events as AnyObj[]) ?? [];
      for (const e of events) {
        if ((e.startTimestamp ?? 0) < cutoff) {
          reachedCutoff = true;
          continue;
        }
        const row = rowOf(id, e);
        if (row) {
          await upsertTeamMatch(row);
          teamCount++;
        }
      }
      if (!data.hasNextPage) break;
    }
    grandTotal += teamCount;
    console.log(`[history] ${t.name.padEnd(22)} ${teamCount} matches  (total ${grandTotal})`);
  }

  console.log(`\n=== History done: ${grandTotal} team-match rows across ${teams.length} teams ===\n`);
}

main()
  .catch((err) => {
    console.error('[history] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await closeDb();
  });
