import { WORLD_CUP } from './config.ts';
import { closeBrowser, getJson, harvest } from './browser.ts';
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

/* ── piggyback refresh (docs/15) ───────────────────────────────────────────────
 * Direct /api/v1 calls are challenged (403) since 2026-06-11. The site's OWN SPA calls
 * still pass, so we land on an allowed entry page and harvest the responses it fires for
 * free — which include the full WC schedule feed (events/next/0, ~200 KB), the date-keyed
 * WC fixtures, and individual /event/{id} details. We upsert every WC (tournament 16)
 * event we capture. Requires a non-blocked egress (SOFA_PROXY_SERVER = the mobile proxy,
 * or a cooled-down IP). */

const WC_EVENTS_RE =
  /\/unique-tournament\/16\/(season\/\d+\/events\/(next|last)\/\d+|scheduled-events\/)|\/event\/\d+$/;

export async function refreshViaPiggyback(): Promise<number> {
  // harvest's own navigation loads the entry page and captures the SPA's calls — no
  // separate warm step needed when we're harvesting the very page we land on
  const hits = await harvest(
    (p) => p.goto('https://www.sofascore.com/football', { waitUntil: 'domcontentloaded', timeout: 60_000 }).then(() => undefined),
    WC_EVENTS_RE,
  );

  const events: AnyObj[] = [];
  for (const [, hit] of hits) {
    if (hit.status !== 200 || !hit.body) continue;
    const b = hit.body as AnyObj;
    if (Array.isArray(b.events)) events.push(...(b.events as AnyObj[])); // feed / scheduled-events
    else if (b.event) events.push(b.event as AnyObj); // single /event/{id}
  }

  let n = 0;
  const seen = new Set<number>();
  for (const e of events) {
    // keep only World Cup (unique-tournament 16) events; scheduled-events mixes competitions
    const utid = e.tournament?.uniqueTournament?.id ?? e.tournament?.id;
    if (utid !== WORLD_CUP.uniqueTournamentId) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    await upsertMatch(matchRowOf(e));
    n++;
  }
  return n;
}

async function main(): Promise<void> {
  // bare-goto transport is dead (403 challenge) — piggyback is the working path
  const n = await refreshViaPiggyback();
  console.log(`[refresh] piggyback: ${n} WC matches upserted`);
  if (n === 0) {
    console.warn('[refresh] 0 matches — egress likely blocked; set SOFA_PROXY_SERVER to the mobile proxy');
  }
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
