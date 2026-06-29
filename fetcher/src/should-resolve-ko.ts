import { WORLD_CUP } from './config.ts';
import { closeDb, dbQuery } from './db.ts';

/**
 * Credit-free gate for the knockout-resolver step (scripts/match-sync.sh → resolve:ko).
 *
 * Later knockout rounds carry placeholder slots (W73, 1A, 3A/3B…) for WEEKS, so "any
 * unresolved slot exists" would have us scrape SofaScore every tick for nothing. Instead we
 * fire ONLY when a tie has actually become resolvable this tick — i.e. every match feeding
 * its unresolved slots is now finished:
 *
 *   exit 0  = a knockout tie just became resolvable → run resolve:ko (a few Firecrawl credits)
 *   exit 10 = nothing newly resolvable → skip (0 credits)
 *
 * Readiness per unresolved slot:
 *   • W{n}/L{n} placeholder → ready when match number n is finished.
 *   • group-position placeholder (1A / 2B / 3A3B… on the R32) → ready when the whole group
 *     stage is finished.
 * A slot already pointing at a real qualifier needs nothing. Match numbering mirrors
 * simulate.ts / the bracket page (R32 73-88, R16 89-96, QF 97-100, SF 101-102, F 103, 3rd 104).
 */

const S = WORLD_CUP.seasonId2026;
const EXIT_PROCEED = 0;
const EXIT_SKIP = 10;
const NUM_START: Record<number, number> = { 6: 73, 5: 89, 27: 97, 28: 101, 29: 103, 50: 104 };

interface Row {
  ss_id: number;
  round: number;
  start_ts: string;
  finished: boolean;
  home_national: boolean;
  away_national: boolean;
  home_ph: string | null;
  away_ph: string | null;
}

function feederNum(name: string | null): number | null {
  const m = /^[WL](\d+)$/.exec((name ?? '').trim().toUpperCase());
  return m ? Number(m[1]) : null;
}

async function main(): Promise<number> {
  const raw = await dbQuery<{
    ss_id: string;
    round: number;
    start_ts: string;
    finished: boolean;
    home_national: boolean;
    away_national: boolean;
    home_ph: string | null;
    away_ph: string | null;
  }>(
    `select m.ss_id, m.round, m.start_ts,
            (m.status_type = 'finished') as finished,
            coalesce(ht.is_national, false) as home_national,
            coalesce(at.is_national, false) as away_national,
            m.raw->'homeTeam'->>'name' as home_ph,
            m.raw->'awayTeam'->>'name' as away_ph
       from public.match m
       left join public.team ht on ht.ss_id = m.home_team_id
       left join public.team at on at.ss_id = m.away_team_id
      where m.season_id = $1 and m.round = any($2::int[])
      order by m.round, m.start_ts`,
    [S, Object.keys(NUM_START).map(Number)],
  );
  const rows: Row[] = raw.map((r) => ({ ...r, ss_id: Number(r.ss_id) }));

  // number each knockout match within its round by kickoff; collect the finished set
  const finishedNums = new Set<number>();
  const counters: Record<number, number> = {};
  for (const r of rows) {
    const num = NUM_START[r.round]! + (counters[r.round] = (counters[r.round] ?? 0) + 1) - 1;
    if (r.finished) finishedNums.add(num);
  }

  // group stage done? (no group match left unfinished)
  const [gs] = await dbQuery<{ pending: string }>(
    `select count(*)::text as pending from public.match
      where season_id = $1 and group_name is not null and status_type is distinct from 'finished'`,
    [S],
  );
  const groupStageDone = Number(gs?.pending ?? '1') === 0;

  const ready = (r: Row): boolean => {
    const slots: Array<{ national: boolean; ph: string | null }> = [
      { national: r.home_national, ph: r.home_ph },
      { national: r.away_national, ph: r.away_ph },
    ];
    let anyUnresolved = false;
    for (const s of slots) {
      if (s.national) continue; // already a real qualifier
      anyUnresolved = true;
      const fn = feederNum(s.ph);
      if (fn != null) {
        if (!finishedNums.has(fn)) return false; // its source match hasn't finished
      } else if (!groupStageDone) {
        return false; // group-derived slot but groups still running
      }
    }
    return anyUnresolved; // ready only if there was something to resolve
  };

  const due = rows.filter(ready);
  if (due.length === 0) {
    console.log('[ko-gate] SKIP — nothing newly resolvable');
    return EXIT_SKIP;
  }
  console.log(`[ko-gate] PROCEED — ${due.length} knockout tie(s) now resolvable`);
  return EXIT_PROCEED;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[ko-gate] fatal:', err);
    process.exitCode = 1; // error → shell treats as skip (fail safe, no credit spend)
  })
  .finally(async () => {
    await closeDb();
  });
