import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, dbQuery, upsertMatchOdds } from './db.ts';
import { upsertQuote } from './edge/db.ts';
import type { NormQuote, Selection } from './edge/types.ts';
import { WORLD_CUP } from './config.ts';

/**
 * SofaScore 1X2 odds via Firecrawl (`npm run edge:sofascore`).
 *
 * SofaScore's /api/v1 odds endpoint is challenge-blocked (403) from every egress we have —
 * the mobile proxy AND Firecrawl's own infra. But Firecrawl can RENDER the public match page
 * (www.sofascore.com/football/match/{slug}/{customId}); the SPA fetches the featured 1X2 odds
 * client-side and they land in the rendered markdown. We scrape that (1 credit/match, markdown
 * format), parse the featured book's 1/X/2 prices (American, decimal or fractional), and write
 * the implied probabilities to BOTH stores:
 *   - public.match_odds   (overround-removed, normalized — same shape as enrich's parseOdds)
 *   - public.edge_quote   (venue 'sofascore', raw 1/decimal per selection — the +EV/arb engine
 *                          removes the vig itself via fair_prob)
 *
 * Cadence: odds barely need hourly — run a few times a day / near kickoff. Requires the
 * Firecrawl CLI authenticated (stored credentials in ~/.config/firecrawl/keys.json).
 */

const S = WORLD_CUP.seasonId2026;
const MAX = Number(process.env.SOFA_FC_MAX ?? 14);
const VENUE = 'sofascore';

interface Cand {
  ss_id: number;
  status_type: string | null;
  start_ts: string;
  slug: string;
  cid: string;
  home_name: string | null;
  away_name: string | null;
}

async function loadCandidates(): Promise<Cand[]> {
  const rows = await dbQuery<Omit<Cand, 'ss_id'> & { ss_id: string }>(
    `select m.ss_id, m.status_type, m.start_ts,
            m.raw->>'slug' as slug, m.raw->>'customId' as cid,
            m.raw->'homeTeam'->>'name' as home_name,
            m.raw->'awayTeam'->>'name' as away_name
       from public.match m
      where m.season_id = $1 and m.raw->>'slug' is not null and m.raw->>'customId' is not null
        and m.start_ts between now() - interval '3 hours' and now() + interval '72 hours'
      order by m.start_ts`,
    [S],
  );
  return rows.map((r) => ({ ...r, ss_id: Number(r.ss_id) }));
}

/** American (+150/-200), fractional (10/11) or decimal (1.91) → decimal odds, or null. */
export function toDecimal(s: string): number | null {
  const t = s.trim();
  if (/^[+-]\d+$/.test(t)) {
    const n = Number(t);
    return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
  }
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]) + 1;
  const d = Number(t);
  return Number.isFinite(d) && d > 1 ? d : null;
}

/**
 * Pull the featured 1X2 prices out of the rendered match-page markdown. SofaScore renders the
 * featured book as `[1\ … <odds>] [X\ … <odds>] [2\ … <odds>]` right after the provider logo
 * and before "Additional odds". Returns decimals + the raw strings/provider, or null.
 */
export function parseMarkdownOdds(md: string):
  | { home: number; draw: number; away: number; raw: { '1': string; X: string; '2': string }; provider: string | null }
  | null {
  // scope to the featured block: from the first odds-provider logo to "Additional odds"
  const start = md.search(/odds\/provider\/\d+\/logo|Full-?time/i);
  const region = start >= 0 ? md.slice(start, start + 1200) : md;
  const provider = region.match(/!\[([^\]]+)\]\(https:\/\/img\.sofascore\.com\/api\/v1\/odds\/provider/)?.[1] ?? null;

  const re = /\[(1|X|2)[\\\s]+([+-]?\d+(?:\.\d+)?(?:\/\d+)?)\]/g;
  const found: Record<string, string> = {};
  for (let m = re.exec(region); m; m = re.exec(region)) {
    const sel = m[1]!;
    if (!(sel in found)) found[sel] = m[2]!; // first occurrence per selection = featured
  }
  if (!found['1'] || !found['X'] || !found['2']) return null;

  const home = toDecimal(found['1']);
  const draw = toDecimal(found['X']);
  const away = toDecimal(found['2']);
  if (home == null || draw == null || away == null) return null;
  return { home, draw, away, raw: { '1': found['1'], X: found['X'], '2': found['2'] }, provider };
}

/** Scrape a match page to markdown via the Firecrawl CLI (1 credit). Returns markdown or null. */
function scrapeMarkdown(url: string): string | null {
  const out = path.join(tmpdir(), `fc-${Math.abs(hashCode(url))}.md`);
  const res = spawnSync(
    'firecrawl',
    ['scrape', url, '--format', 'markdown', '--country', 'HR', '--wait-for', '5000', '-o', out],
    { encoding: 'utf8', timeout: 90_000 },
  );
  if (res.status !== 0) {
    console.warn(`[sofa-fc] scrape failed (${res.status}): ${String(res.stderr).slice(0, 120)}`);
    return null;
  }
  return out;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

async function main(): Promise<void> {
  const cands = (await loadCandidates()).slice(0, MAX);
  if (cands.length === 0) {
    console.log('[sofa-fc] no candidate matches in window');
    return;
  }
  console.log(`[sofa-fc] scraping odds for ${cands.length} matches via Firecrawl`);

  let ok = 0;
  for (const c of cands) {
    const url = `https://www.sofascore.com/football/match/${c.slug}/${c.cid}`;
    const file = scrapeMarkdown(url);
    if (!file) continue;
    let md: string;
    try {
      md = await readFile(file, 'utf8');
    } catch {
      continue;
    } finally {
      await rm(file, { force: true });
    }

    const odds = parseMarkdownOdds(md);
    if (!odds) {
      console.warn(`[sofa-fc] ${c.slug}: no featured 1X2 odds in render`);
      continue;
    }

    // raw implied (per selection, includes vig) for edge_quote
    const invH = 1 / odds.home, invD = 1 / odds.draw, invA = 1 / odds.away;
    const sum = invH + invD + invA;
    const r4 = (v: number) => Math.round(v * 10000) / 10000;

    // match_odds: normalized, overround removed (mirrors enrich's parseOdds output)
    await upsertMatchOdds({
      match_id: c.ss_id,
      status_at_fetch: c.status_type,
      imp_home: r4(invH / sum),
      imp_draw: r4(invD / sum),
      imp_away: r4(invA / sum),
      raw: { source: 'firecrawl', provider: odds.provider, decimals: odds, url } as unknown as Record<string, unknown>,
    });

    // edge_quote: one row per selection, raw implied (engine removes vig via fair_prob)
    const sels: [Selection, number, number][] = [
      ['home', odds.home, invH],
      ['draw', odds.draw, invD],
      ['away', odds.away, invA],
    ];
    for (const [selection, decimalOdds, inv] of sels) {
      const q: NormQuote = {
        venueId: VENUE,
        externalEventId: String(c.ss_id),
        market: '1x2',
        selection,
        decimalOdds,
        impliedProb: r4(inv),
        homeName: c.home_name ?? undefined,
        awayName: c.away_name ?? undefined,
        startTs: c.start_ts,
        extra: { provider: odds.provider, url, raw_odds: odds.raw },
        raw: { source: 'firecrawl', provider: odds.provider },
      };
      await upsertQuote(q, c.ss_id);
    }

    ok++;
    console.log(
      `[sofa-fc] ${c.home_name ?? c.slug} vs ${c.away_name ?? ''}: ` +
        `1=${odds.raw['1']} X=${odds.raw.X} 2=${odds.raw['2']} → ` +
        `${r4(invH / sum)}/${r4(invD / sum)}/${r4(invA / sum)} (${odds.provider ?? '?'})`,
    );
  }
  console.log(`[sofa-fc] stored odds for ${ok}/${cands.length} matches (match_odds + edge_quote)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('[sofa-fc] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
