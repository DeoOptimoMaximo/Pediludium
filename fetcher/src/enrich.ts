import { WORLD_CUP } from './config.ts';
import { closeBrowser, getJson } from './browser.ts';
import {
  EventLineupsResponseSchema,
  EventOddsResponseSchema,
  EventShotmapResponseSchema,
  EventStatisticsResponseSchema,
  EventVotesResponseSchema,
} from './schemas.ts';
import {
  closeDb,
  dbQuery,
  upsertMatchLineups,
  upsertMatchOdds,
  upsertMatchShotmap,
  upsertMatchStatistics,
  upsertMatchVotes,
} from './db.ts';

/**
 * Per-match enrichment tick (`npm run enrich`) — pulls the richer SofaScore payloads the
 * models and the UI build on: team statistics (xG!), lineups (missing players), 1X2 odds,
 * fan votes, shotmap. Same polite browser transport as refresh; budget-aware:
 *   - odds + votes   → matches kicking off within ODDS_WINDOW_H (re-captured every tick,
 *                      so the stored row converges to the closing odds), plus one
 *                      post-hoc capture if we never saw the match pre-kickoff
 *   - lineups        → from LINEUP_WINDOW_MIN before kick-off (XI publishes ~1h ahead),
 *                      while live, and once more after the final whistle
 *   - stats + shotmap → while live, and once more after the final whistle
 * A row whose status_at_fetch is 'finished' is final and never refetched. Endpoints 404
 * until their data exists (e.g. shotmap pre-match) — those failures are logged + skipped.
 */

const S = WORLD_CUP.seasonId2026;
const ODDS_WINDOW_H = Number(process.env.ENRICH_ODDS_WINDOW_H ?? 48);
const LINEUP_WINDOW_MIN = Number(process.env.ENRICH_LINEUP_WINDOW_MIN ?? 90);
const MAX_REQUESTS = Number(process.env.ENRICH_MAX_REQ ?? 60);

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

interface Candidate {
  ss_id: number;
  status_type: string | null;
  start_ts: string;
  stats_at: string | null;
  lineups_at: string | null;
  odds_at: string | null;
  votes_at: string | null;
  shotmap_at: string | null;
}

async function loadCandidates(): Promise<Candidate[]> {
  const rows = await dbQuery<Candidate & { ss_id: string }>(
    `select m.ss_id, m.status_type, m.start_ts,
            st.status_at_fetch as stats_at,
            lu.status_at_fetch as lineups_at,
            od.status_at_fetch as odds_at,
            vt.status_at_fetch as votes_at,
            sm.status_at_fetch as shotmap_at
       from public.match m
       left join public.match_statistics st on st.match_id = m.ss_id
       left join public.match_lineups    lu on lu.match_id = m.ss_id
       left join public.match_odds       od on od.match_id = m.ss_id
       left join public.match_votes      vt on vt.match_id = m.ss_id
       left join public.match_shotmap    sm on sm.match_id = m.ss_id
      where m.season_id = $1 and m.start_ts is not null
      order by m.start_ts`,
    [S],
  );
  return rows.map((r) => ({ ...r, ss_id: Number(r.ss_id) }));
}

/* ── raw-payload parsers (tolerant: missing pieces → null, raw is preserved anyway) ── */

function numOf(it: AnyObj | undefined, side: 'home' | 'away'): number | null {
  if (!it) return null;
  const v = it[`${side}Value`] ?? it[side];
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : null;
}

export function parseStatistics(raw: AnyObj): Omit<Parameters<typeof upsertMatchStatistics>[0], 'match_id' | 'status_at_fetch' | 'raw'> {
  const periods: AnyObj[] = raw?.statistics ?? [];
  const all = periods.find((p) => p.period === 'ALL') ?? periods[0];
  const items: AnyObj[] = [];
  for (const g of all?.groups ?? []) for (const it of g.statisticsItems ?? []) items.push(it);
  const find = (...keys: string[]) => items.find((it) => keys.includes(it.key) || keys.includes(it.name));
  const xg = find('expectedGoals', 'Expected goals');
  const poss = find('ballPossession', 'Ball possession');
  const shots = find('totalShotsOnGoal', 'Total shots');
  const onTarget = find('shotsOnGoal', 'Shots on target');
  return {
    xg_home: numOf(xg, 'home'),
    xg_away: numOf(xg, 'away'),
    possession_home: numOf(poss, 'home'),
    possession_away: numOf(poss, 'away'),
    shots_home: numOf(shots, 'home'),
    shots_away: numOf(shots, 'away'),
    shots_on_home: numOf(onTarget, 'home'),
    shots_on_away: numOf(onTarget, 'away'),
  };
}

/** "10/11" → decimal 1.909…; plain decimals pass through. */
function decimalOdds(choice: AnyObj | undefined): number | null {
  const f = String(choice?.fractionalValue ?? '');
  const frac = f.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]) + 1;
  const n = Number(f);
  return Number.isFinite(n) && n > 1 ? n : null;
}

export function parseOdds(raw: AnyObj): { imp_home: number | null; imp_draw: number | null; imp_away: number | null } {
  const markets: AnyObj[] = raw?.markets ?? [];
  const market = markets.find((m) => m.marketName === 'Full time' || m.marketId === 1);
  const byName = new Map<string, number | null>(
    (market?.choices ?? []).map((c: AnyObj) => [String(c.name), decimalOdds(c)]),
  );
  const dec = ['1', 'X', '2'].map((k) => byName.get(k) ?? null);
  if (dec.some((d) => d == null)) return { imp_home: null, imp_draw: null, imp_away: null };
  const inv = dec.map((d) => 1 / d!);
  const sum = inv.reduce((a, b) => a + b, 0); // overround removed by normalizing
  const r4 = (v: number) => Math.round((v / sum) * 10000) / 10000;
  return { imp_home: r4(inv[0]!), imp_draw: r4(inv[1]!), imp_away: r4(inv[2]!) };
}

export function parseVotes(raw: AnyObj): { votes_home: number | null; votes_draw: number | null; votes_away: number | null } {
  const v = raw?.vote ?? {};
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return { votes_home: n(v.vote1), votes_draw: n(v.voteX), votes_away: n(v.vote2) };
}

/* ── tick planning ── */

interface Job {
  matchId: number;
  kind: 'statistics' | 'lineups' | 'odds' | 'votes' | 'shotmap';
  run: () => Promise<void>;
}

export function wantsEnrichment(c: Pick<Candidate, 'status_type' | 'start_ts' | 'stats_at' | 'lineups_at' | 'odds_at' | 'votes_at' | 'shotmap_at'>, now: Date): Job['kind'][] {
  const minsToKickoff = (new Date(c.start_ts).getTime() - now.getTime()) / 60_000;
  const upcoming = c.status_type === 'notstarted';
  const live = c.status_type === 'inprogress';
  const finished = c.status_type === 'finished';
  const kinds: Job['kind'][] = [];

  // pre-match markets/crowd: every tick inside the window; once post-hoc if missed
  const preWindow = upcoming && minsToKickoff <= ODDS_WINDOW_H * 60;
  if (preWindow || ((live || finished) && c.odds_at == null)) kinds.push('odds');
  if (preWindow || ((live || finished) && c.votes_at == null)) kinds.push('votes');

  if ((upcoming && minsToKickoff <= LINEUP_WINDOW_MIN) || live || (finished && c.lineups_at !== 'finished'))
    kinds.push('lineups');
  if (live || (finished && c.stats_at !== 'finished')) kinds.push('statistics');
  if (live || (finished && c.shotmap_at !== 'finished')) kinds.push('shotmap');
  return kinds;
}

function jobOf(c: Candidate, kind: Job['kind']): Job {
  const id = c.ss_id;
  const status = c.status_type ?? null;
  const runs: Record<Job['kind'], () => Promise<void>> = {
    statistics: async () => {
      const { raw } = await getJson(`/event/${id}/statistics`, EventStatisticsResponseSchema);
      await upsertMatchStatistics({ match_id: id, status_at_fetch: status, ...parseStatistics(raw as AnyObj), raw });
    },
    lineups: async () => {
      const { raw } = await getJson(`/event/${id}/lineups`, EventLineupsResponseSchema);
      const r = raw as AnyObj;
      await upsertMatchLineups({
        match_id: id,
        status_at_fetch: status,
        confirmed: typeof r.confirmed === 'boolean' ? r.confirmed : null,
        home_formation: r.home?.formation ?? null,
        away_formation: r.away?.formation ?? null,
        // arrays must be pre-stringified: node-pg would render a JS array as a PG array literal
        home_missing: JSON.stringify(r.home?.missingPlayers ?? []),
        away_missing: JSON.stringify(r.away?.missingPlayers ?? []),
        raw,
      });
    },
    odds: async () => {
      const { raw } = await getJson(`/event/${id}/odds/1/all`, EventOddsResponseSchema);
      await upsertMatchOdds({ match_id: id, status_at_fetch: status, ...parseOdds(raw as AnyObj), raw });
    },
    votes: async () => {
      const { raw } = await getJson(`/event/${id}/votes`, EventVotesResponseSchema);
      await upsertMatchVotes({ match_id: id, status_at_fetch: status, ...parseVotes(raw as AnyObj), raw });
    },
    shotmap: async () => {
      const { raw } = await getJson(`/event/${id}/shotmap`, EventShotmapResponseSchema);
      await upsertMatchShotmap(id, status, JSON.stringify((raw as AnyObj).shotmap ?? []));
    },
  };
  return { matchId: id, kind, run: runs[kind] };
}

async function main(): Promise<void> {
  const now = new Date();
  const candidates = await loadCandidates();
  const jobs: Job[] = [];
  for (const c of candidates) for (const kind of wantsEnrichment(c, now)) jobs.push(jobOf(c, kind));

  if (jobs.length > MAX_REQUESTS) {
    console.warn(`[enrich] ${jobs.length} jobs planned, capping at ${MAX_REQUESTS} (ENRICH_MAX_REQ)`);
  }
  let ok = 0;
  let failed = 0;
  for (const job of jobs.slice(0, MAX_REQUESTS)) {
    try {
      await job.run();
      ok++;
    } catch (err) {
      failed++; // 404 = data not published yet (e.g. shotmap pre-match) — normal, retried next tick
      console.warn(`[enrich] ${job.kind} ${job.matchId}: ${String(err).slice(0, 90)}`);
    }
  }
  console.log(`[enrich] ${ok} fetched, ${failed} skipped/failed of ${jobs.length} planned (${candidates.length} matches scanned)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('[enrich] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeBrowser();
      await closeDb();
    });
}
