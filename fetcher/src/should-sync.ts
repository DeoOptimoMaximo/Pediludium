import { WORLD_CUP } from './config.ts';
import { closeDb, dbQuery } from './db.ts';

/**
 * Schedule-aware gate for the frequent match-sync job (scripts/match-sync.sh).
 *
 * The hourly snapshot pipeline only fetches results through the (flaky) mobile-proxy
 * piggyback, so when the phone proxy is asleep a finished match can sit on the public
 * scorecard as "scheduled" for hours. This gate lets a lightweight job run every ~15 min
 * and spend Firecrawl credits ONLY while a match is actually in play or just ended:
 *
 *   exit 0  = a match is in its active window (worth a Firecrawl result check)
 *   exit 10 = nothing in window → skip (0 credits, 0 work)
 *
 * Active window: not yet 'finished' in our DB AND kickoff is within [now-WINDOW_H, now+15m].
 * WINDOW_H (default 18h) must cover not just one match (90' + ET/penalties + the lag before
 * SofaScore flips to Finished) but an overnight: an evening kickoff that finishes while no
 * tick lands (Mac asleep, or Firecrawl serving a stale cached render) must still be inside the
 * window the next morning so it finally gets caught — not stranded as "scheduled" for a day.
 * A match leaves the window the instant it is marked finished, so the wide window costs nothing
 * in steady state; it only keeps still-unresolved recent matches eligible for one more check.
 */

const WINDOW_H = Number(process.env.SYNC_WINDOW_H ?? 18);
const EXIT_PROCEED = 0;
const EXIT_SKIP = 10;

async function main(): Promise<number> {
  const rows = await dbQuery<{ ss_id: string; home: string | null; away: string | null; start_ts: string }>(
    `select m.ss_id, m.raw->'homeTeam'->>'name' as home, m.raw->'awayTeam'->>'name' as away,
            m.start_ts
       from public.match m
      where m.season_id = $1
        and m.status_type is distinct from 'finished'
        and m.start_ts < now() + interval '15 minutes'
        and m.start_ts > now() - make_interval(hours => $2)
      order by m.start_ts`,
    [WORLD_CUP.seasonId2026, WINDOW_H],
  );
  if (rows.length === 0) {
    console.log('[sync-gate] SKIP — no match in active window');
    return EXIT_SKIP;
  }
  const names = rows.map((r) => `${r.home ?? '?'} v ${r.away ?? '?'}`).join(', ');
  console.log(`[sync-gate] PROCEED — ${rows.length} match(es) in window: ${names}`);
  return EXIT_PROCEED;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[sync-gate] fatal:', err);
    process.exitCode = 1; // error → shell treats as skip (fail safe, no credit spend)
  })
  .finally(async () => {
    await closeDb();
  });
