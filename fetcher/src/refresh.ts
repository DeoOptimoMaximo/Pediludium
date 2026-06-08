import { WORLD_CUP } from './config.ts';
import { closeBrowser, getJson } from './browser.ts';
import { EventResponseSchema, EventsResponseSchema } from './schemas.ts';
import { closeDb, dbQuery, upsertMatch } from './db.ts';
import { matchRowOf } from './map.ts';

/**
 * One idempotent refresh tick (docs/03 polling cadence). Used by the scheduler loop and
 * runnable standalone (`npm run refresh [--full]`). Phase-aware:
 *   - active matches (live now, or kicking off within the window) → poll /event/{id}
 *   - --full → re-pull the whole schedule (events/next + events/last) for status/score flips
 * Every write upserts by ss_id; Supabase Realtime then pushes the change to the UI.
 */

const T = WORLD_CUP.uniqueTournamentId;
const S = WORLD_CUP.seasonId2026;

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

/** Matches that are live now or about to start — the ones worth polling frequently. */
export async function activeMatchIds(): Promise<number[]> {
  const rows = await dbQuery<{ ss_id: string }>(
    `select ss_id from public.match
       where season_id = $1
         and ( status_type = 'inprogress'
            or ( status_type is distinct from 'finished'
                 and start_ts between now() - interval '15 minutes' and now() + interval '60 minutes' ) )
       order by start_ts`,
    [S],
  );
  return rows.map((r) => Number(r.ss_id));
}

export async function refreshActive(): Promise<number> {
  const ids = await activeMatchIds();
  let updated = 0;
  for (const id of ids) {
    try {
      const { raw } = await getJson(`/event/${id}`, EventResponseSchema);
      await upsertMatch(matchRowOf((raw as AnyObj).event));
      updated++;
    } catch (err) {
      console.warn(`[refresh] event ${id}: ${String(err).slice(0, 70)}`);
    }
  }
  return updated;
}

export async function refreshSchedule(): Promise<number> {
  let n = 0;
  for (const dir of ['next', 'last'] as const) {
    for (let page = 0; page < 40; page++) {
      let data;
      let raw;
      try {
        ({ data, raw } = await getJson(
          `/unique-tournament/${T}/season/${S}/events/${dir}/${page}`,
          EventsResponseSchema,
        ));
      } catch {
        break;
      }
      for (const e of ((raw as AnyObj).events as AnyObj[]) ?? []) {
        await upsertMatch(matchRowOf(e));
        n++;
      }
      if (!data.hasNextPage) break;
    }
  }
  return n;
}

async function main(): Promise<void> {
  const full = process.argv.includes('--full');
  if (full) {
    const n = await refreshSchedule();
    console.log(`[refresh] schedule re-pulled: ${n} matches`);
  }
  const active = await activeMatchIds();
  const updated = await refreshActive();
  console.log(`[refresh] active matches: ${active.length}, updated: ${updated}`);
}

// run as a one-shot only when invoked directly (the scheduler imports the functions instead)
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('[refresh] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeBrowser();
      await closeDb();
    });
}
