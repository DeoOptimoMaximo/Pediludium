import { WORLD_CUP } from './config.ts';
import { closeBrowser, harvestMatchView, warmEntry, type HarvestHit } from './browser.ts';
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
 * fan votes, shotmap. Uses the PIGGYBACK transport (docs/15): direct /api/v1 calls are
 * challenge-blocked, so we open each match's view inside the warm SPA and harvest the
 * responses its own JS fires. One match view reliably yields lineups + odds + votes;
 * statistics + shotmap sit behind the Statistics sub-tab and are captured only when present
 * (follow-up). Budget-aware which matches to visit:
 *   - odds + votes   → matches kicking off within ODDS_WINDOW_H (re-visited each tick, so the
 *                      stored row converges to the closing odds), plus a post-hoc visit if missed
 *   - lineups        → from LINEUP_WINDOW_MIN before kick-off, while live, once after FT
 *   - stats + shotmap → while live, and once after FT
 * A row whose status_at_fetch is 'finished' is final and not re-fetched. Requires a working
 * egress (SOFA_PROXY_SERVER = the mobile proxy); the phone must be foreground.
 */

const S = WORLD_CUP.seasonId2026;
const ODDS_WINDOW_H = Number(process.env.ENRICH_ODDS_WINDOW_H ?? 48);
const LINEUP_WINDOW_MIN = Number(process.env.ENRICH_LINEUP_WINDOW_MIN ?? 90);
const MAX_MATCHES = Number(process.env.ENRICH_MAX_MATCHES ?? 12);

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

interface Candidate {
  ss_id: number;
  status_type: string | null;
  start_ts: string;
  slug: string | null;
  custom_id: string | null;
  stats_at: string | null;
  lineups_at: string | null;
  odds_at: string | null;
  votes_at: string | null;
  shotmap_at: string | null;
}

async function loadCandidates(): Promise<Candidate[]> {
  const rows = await dbQuery<Candidate & { ss_id: string }>(
    `select m.ss_id, m.status_type, m.start_ts,
            m.raw->>'slug' as slug, m.raw->>'customId' as custom_id,
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

type Kind = 'statistics' | 'lineups' | 'odds' | 'votes' | 'shotmap';

/** Which payloads this match still wants (drives whether it's worth a match-view visit). */
export function wantsEnrichment(c: Pick<Candidate, 'status_type' | 'start_ts' | 'stats_at' | 'lineups_at' | 'odds_at' | 'votes_at' | 'shotmap_at'>, now: Date): Kind[] {
  const minsToKickoff = (new Date(c.start_ts).getTime() - now.getTime()) / 60_000;
  const upcoming = c.status_type === 'notstarted';
  const live = c.status_type === 'inprogress';
  const finished = c.status_type === 'finished';
  const kinds: Kind[] = [];

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

const MATCH_WANT = /\/event\/\d+\/(statistics|lineups|votes|shotmap|odds\/1\/all)$/;

/** Upsert whatever payloads we captured from one match view. Returns the kinds stored. */
async function upsertFromHarvest(c: Candidate, hits: Map<string, HarvestHit>): Promise<Kind[]> {
  const id = c.ss_id;
  const status = c.status_type ?? null;
  const stored: Kind[] = [];
  const bodyOf = (suffix: string): AnyObj | undefined => {
    for (const [path, hit] of hits) {
      if (path.endsWith(`/event/${id}/${suffix}`) && hit.status === 200 && hit.body) return hit.body as AnyObj;
    }
    return undefined;
  };

  const lineups = bodyOf('lineups');
  if (lineups) {
    await upsertMatchLineups({
      match_id: id,
      status_at_fetch: status,
      confirmed: typeof lineups.confirmed === 'boolean' ? lineups.confirmed : null,
      home_formation: lineups.home?.formation ?? null,
      away_formation: lineups.away?.formation ?? null,
      // arrays must be pre-stringified: node-pg would render a JS array as a PG array literal
      home_missing: JSON.stringify(lineups.home?.missingPlayers ?? []),
      away_missing: JSON.stringify(lineups.away?.missingPlayers ?? []),
      raw: lineups,
    });
    stored.push('lineups');
  }
  const odds = bodyOf('odds/1/all');
  if (odds) {
    await upsertMatchOdds({ match_id: id, status_at_fetch: status, ...parseOdds(odds), raw: odds });
    stored.push('odds');
  }
  const votes = bodyOf('votes');
  if (votes) {
    await upsertMatchVotes({ match_id: id, status_at_fetch: status, ...parseVotes(votes), raw: votes });
    stored.push('votes');
  }
  const stats = bodyOf('statistics');
  if (stats) {
    await upsertMatchStatistics({ match_id: id, status_at_fetch: status, ...parseStatistics(stats), raw: stats });
    stored.push('statistics');
  }
  const shotmap = bodyOf('shotmap');
  if (shotmap) {
    await upsertMatchShotmap(id, status, JSON.stringify(shotmap.shotmap ?? []));
    stored.push('shotmap');
  }
  return stored;
}

async function main(): Promise<void> {
  const now = new Date();
  const candidates = await loadCandidates();
  const todo = candidates.filter((c) => c.slug && wantsEnrichment(c, now).length > 0);
  const visit = todo.slice(0, MAX_MATCHES);
  if (todo.length > visit.length) {
    console.warn(`[enrich] ${todo.length} matches want enrichment, visiting ${visit.length} this tick (ENRICH_MAX_MATCHES)`);
  }
  if (visit.length === 0) {
    console.log('[enrich] nothing to enrich this tick');
    return;
  }

  await warmEntry('/football');
  let visited = 0;
  const tally: Record<string, number> = {};
  for (const c of visit) {
    try {
      const hits = await harvestMatchView({ eventId: c.ss_id, slug: c.slug!, customId: c.custom_id ?? '' }, MATCH_WANT);
      const stored = await upsertFromHarvest(c, hits);
      for (const k of stored) tally[k] = (tally[k] ?? 0) + 1;
      visited++;
    } catch (err) {
      console.warn(`[enrich] match ${c.ss_id}: ${String(err).slice(0, 90)}`);
    }
  }
  const summary = Object.entries(tally).map(([k, n]) => `${k}=${n}`).join(' ') || 'nothing stored';
  console.log(`[enrich] visited ${visited}/${visit.length} match views · stored ${summary}`);
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
