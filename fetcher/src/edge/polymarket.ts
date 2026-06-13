import { config } from '../config.ts';
import type { MarketKind, NormQuote, Selection } from './types.ts';
import { impliedFromDecimal } from './types.ts';
import { matchEvent, normName, type FixtureMatch } from './match-link.ts';

/**
 * Polymarket read client (no auth). Two surfaces:
 *  - Gamma (gamma-api.polymarket.com): event/market discovery + metadata.
 *  - CLOB (clob.polymarket.com): live order book / midpoint per ERC1155 token.
 *
 * v2 stack note (cutover 2026-04-28): trading collateral is pUSD and orders go through
 * clob-client-v2 — but ALL of the below is read-only and unaffected. Prices are 0..1 in
 * pUSD; price p → implied prob p → decimal odds 1/p.
 *
 * Per-fixture, Polymarket splits markets across several events: the bare "A vs. B"
 * (full-match 3-way moneyline), "A vs. B - More Markets" (totals/handicaps), plus
 * half/prop variants we ignore. Several Gamma fields arrive as JSON strings inside the
 * JSON (outcomes, outcomePrices, clobTokenIds) — parsed defensively.
 */

const UA = 'pediludium-edge/0.1 (+https://lopta-je-okrugla)';
const DEFAULT_TAGS = ['2026-fifa-world-cup', 'soccer'];

async function getJson(
  host: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<unknown> {
  const url = new URL(host + path);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`[polymarket] ${res.status} ${url.pathname}${url.search}`);
  return res.json();
}

function parseJsonField<T>(v: unknown): T | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return undefined;
  }
}

/* ── Gamma discovery ───────────────────────────────────────────────────────── */

interface GammaMarket {
  id?: string;
  question?: string;
  groupItemTitle?: string;
  conditionId?: string;
  slug?: string;
  outcomes?: unknown; // JSON string: ["Yes","No"] or ["Over","Under"]
  outcomePrices?: unknown; // JSON string: ["0.65","0.35"] aligned to outcomes
  clobTokenIds?: unknown; // JSON string: token id per outcome
  active?: boolean;
  closed?: boolean;
  negRisk?: boolean;
}

interface GammaEvent {
  id?: string;
  title?: string;
  slug?: string;
  startDate?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  markets?: GammaMarket[];
}

/** Page through active, open events for the WC + soccer tags (or PM_TAG_SLUGS). */
export async function fetchActiveEvents(maxPages = 12, pageSize = 100): Promise<GammaEvent[]> {
  const tagSlugs = (config.pmTagSlugs ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tags = tagSlugs.length ? tagSlugs : DEFAULT_TAGS;

  const out: GammaEvent[] = [];
  const seen = new Set<string>();
  for (const slug of tags) {
    for (let page = 0; page < maxPages; page++) {
      const batch = (await getJson(config.pmGammaHost, '/events', {
        active: true,
        closed: false,
        order: 'startDate',
        ascending: false,
        limit: pageSize,
        offset: page * pageSize,
        tag_slug: slug,
      })) as GammaEvent[];
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const e of batch) {
        const key = e.id ?? e.slug ?? '';
        if (key && !seen.has(key)) {
          seen.add(key);
          out.push(e);
        }
      }
      if (batch.length < pageSize) break;
    }
  }
  return out;
}

/* ── CLOB live price ───────────────────────────────────────────────────────── */

/** Live midpoint for a token (0..1). Falls back to undefined on any error. */
export async function clobMidpoint(tokenId: string): Promise<number | undefined> {
  try {
    const r = (await getJson(config.pmClobHost, '/midpoint', { token_id: tokenId })) as {
      mid?: string;
    };
    const v = Number(r.mid);
    return Number.isFinite(v) && v > 0 && v < 1 ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Best ask (lowest sell) for a token — the price you'd pay to BUY one share. */
export async function clobBestAsk(tokenId: string): Promise<number | undefined> {
  try {
    const r = (await getJson(config.pmClobHost, '/price', {
      token_id: tokenId,
      side: 'sell',
    })) as { price?: string };
    const v = Number(r.price);
    return Number.isFinite(v) && v > 0 && v < 1 ? v : undefined;
  } catch {
    return undefined;
  }
}

/* ── event → normalized quotes ─────────────────────────────────────────────── */

type Variant = 'moneyline' | 'totals' | null;

/** Classify the event variant by its title suffix; parse the two team strings. */
function classifyEvent(title: string): { variant: Variant; home: string; away: string } | null {
  const t = title.trim();
  const dash = t.indexOf(' - ');
  const base = dash >= 0 ? t.slice(0, dash).trim() : t;
  const suffix = dash >= 0 ? t.slice(dash + 3).trim().toLowerCase() : '';
  let variant: Variant = null;
  if (!suffix) variant = 'moneyline';
  else if (suffix === 'more markets') variant = 'totals';
  else return null; // halves, props, exact score, corners, etc. → skip
  const parts = base.split(/\s+vs\.?\s+|\s+v\s+/i);
  if (parts.length !== 2 || !parts[0]!.trim() || !parts[1]!.trim()) return null;
  return { variant, home: parts[0]!.trim(), away: parts[1]!.trim() };
}

/**
 * Map one market's outcomes to our (market, selection) tuples. Moneyline markets are
 * binary YES/NO where the groupItemTitle is the team/draw (only the YES leg matters);
 * the full-match total is a single "O/U 2.5" market with outcomes [Over, Under].
 */
function classifyMarket(
  mk: GammaMarket,
  variant: Variant,
  fixture: FixtureMatch['fixture'],
): Array<{ market: MarketKind; selection: Selection; outcomeIndex: number }> {
  const git = (mk.groupItemTitle ?? '').trim();
  if (variant === 'moneyline') {
    if (/draw|tie/i.test(git)) return [{ market: '1x2', selection: 'draw', outcomeIndex: 0 }];
    const n = normName(git);
    if (n && (n.includes(fixture.homeKey) || fixture.homeKey.includes(n)))
      return [{ market: '1x2', selection: 'home', outcomeIndex: 0 }];
    if (n && (n.includes(fixture.awayKey) || fixture.awayKey.includes(n)))
      return [{ market: '1x2', selection: 'away', outcomeIndex: 0 }];
    return [];
  }
  if (variant === 'totals' && /^o\/u\s*2\.?5$/i.test(git)) {
    const outcomes = parseJsonField<string[]>(mk.outcomes) ?? [];
    const res: Array<{ market: MarketKind; selection: Selection; outcomeIndex: number }> = [];
    outcomes.forEach((o, i) => {
      if (/over/i.test(o)) res.push({ market: 'ou25', selection: 'over', outcomeIndex: i });
      else if (/under/i.test(o)) res.push({ market: 'ou25', selection: 'under', outcomeIndex: i });
    });
    return res;
  }
  return [];
}

export interface PmEventQuotes {
  fixtureMatchId: number;
  eventTitle: string;
  conditionId: string;
  quotes: NormQuote[];
}

/**
 * For each active event that matches one of our fixtures, build normalized 1x2 / ou25
 * quotes. Uses live CLOB midpoints when `refine` is set (more accurate than the cached
 * Gamma outcomePrices), else the Gamma snapshot price.
 */
export async function collectPolymarketQuotes(refine = true): Promise<PmEventQuotes[]> {
  const events = await fetchActiveEvents();
  console.log(`[pm] fetched ${events.length} active events from Gamma`);
  const byFixture = new Map<number, PmEventQuotes>();

  for (const e of events) {
    const cls = classifyEvent(e.title ?? '');
    if (!cls) continue;
    const fm = await matchEvent(cls.home, cls.away);
    if (!fm) continue;

    for (const mk of e.markets ?? []) {
      if (mk.closed) continue;
      const targets = classifyMarket(mk, cls.variant, fm.fixture);
      if (!targets.length) continue;
      const tokenIds = parseJsonField<string[]>(mk.clobTokenIds);
      const prices = parseJsonField<string[]>(mk.outcomePrices);

      for (const t of targets) {
        const token = tokenIds?.[t.outcomeIndex];
        let price = prices?.[t.outcomeIndex] !== undefined ? Number(prices[t.outcomeIndex]) : undefined;
        if (refine && token) {
          const live = await clobMidpoint(token);
          if (live !== undefined) price = live;
        }
        if (price === undefined || !(price > 0 && price < 1)) continue;

        const decimalOdds = 1 / price;
        const q: NormQuote = {
          venueId: 'polymarket',
          externalEventId: `${fm.fixture.matchId}:${t.market}:${t.selection}`,
          market: t.market,
          selection: t.selection,
          decimalOdds,
          impliedProb: impliedFromDecimal(decimalOdds),
          homeName: fm.fixture.homeName,
          awayName: fm.fixture.awayName,
          startTs: e.startDate ?? undefined,
          extra: {
            tokenId: token,
            conditionId: mk.conditionId,
            price,
            negRisk: mk.negRisk,
            eventSlug: e.slug, // → https://polymarket.com/event/<slug> for the verify link
          },
          raw: { event: e.title, git: mk.groupItemTitle },
        };
        const bucket =
          byFixture.get(fm.fixture.matchId) ??
          ({
            fixtureMatchId: fm.fixture.matchId,
            eventTitle: cls.home + ' vs ' + cls.away,
            conditionId: mk.conditionId ?? e.slug ?? '',
            quotes: [],
          } satisfies PmEventQuotes);
        // last write wins per selection (moneyline event > stale snapshot)
        bucket.quotes = bucket.quotes.filter((x) => !(x.market === q.market && x.selection === q.selection));
        bucket.quotes.push(q);
        byFixture.set(fm.fixture.matchId, bucket);
      }
    }
  }
  return [...byFixture.values()];
}
