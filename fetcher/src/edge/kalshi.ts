import type { NormQuote, Selection } from './types.ts';
import { impliedFromDecimal } from './types.ts';
import { matchEvent, normName } from './match-link.ts';

/**
 * Kalshi read client (no auth for market data). Kalshi is a CFTC-regulated event-contract
 * exchange — like Polymarket but USD/regulated, not crypto. World Cup match winner lives in
 * the series KXWCGAME: one event per match (e.g. KXWCGAME-26JUN27JORARG) with three binary
 * markets whose `yes_sub_title` is the team name or "Tie" → maps cleanly to our 1x2.
 *
 * Prices come as dollar strings 0..1 in the *_dollars fields (newer API). Buying a YES
 * contract costs `yes_ask_dollars` and pays $1 → decimal odds = 1 / ask. We fall back to
 * last trade price when there's no live ask (WC markets are often thin this far out).
 */

const HOST = 'https://api.elections.kalshi.com/trade-api/v2';
const SERIES = 'KXWCGAME';
const UA = 'pediludium-edge/0.1';
// reliable verify link — the series page lists every WC game market (per-event slug isn't
// exposed by the API and the deep link 429'd during probing)
const SERIES_URL = 'https://kalshi.com/markets/kxwcgame';

interface KMarket {
  ticker?: string;
  event_ticker?: string;
  yes_sub_title?: string;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  last_price_dollars?: string;
  liquidity_dollars?: string;
  status?: string;
}

async function getJson(path: string, params: Record<string, string | number>): Promise<any> {
  const url = new URL(HOST + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) throw new Error(`[kalshi] ${res.status} ${url.pathname}${url.search}`);
  return res.json();
}

/** All open KXWCGAME markets, paged via Kalshi's cursor. */
export async function fetchGameMarkets(): Promise<KMarket[]> {
  const out: KMarket[] = [];
  let cursor = '';
  for (let i = 0; i < 20; i++) {
    const j = (await getJson('/markets', {
      series_ticker: SERIES,
      status: 'open',
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })) as { markets?: KMarket[]; cursor?: string };
    const ms = j.markets ?? [];
    out.push(...ms);
    cursor = j.cursor ?? '';
    if (!cursor || !ms.length) break;
  }
  return out;
}

/** Buy-side price 0..1: prefer the live ask, fall back to last trade. undefined if neither. */
function buyPrice(m: KMarket): number | undefined {
  const ask = Number(m.yes_ask_dollars);
  if (Number.isFinite(ask) && ask > 0 && ask < 1) return ask;
  const last = Number(m.last_price_dollars);
  if (Number.isFinite(last) && last > 0 && last < 1) return last;
  return undefined;
}

export interface KalshiEventQuotes {
  fixtureMatchId: number;
  eventTicker: string;
  quotes: NormQuote[];
}

export async function collectKalshiQuotes(): Promise<KalshiEventQuotes[]> {
  const markets = await fetchGameMarkets();
  console.log(`[kalshi] fetched ${markets.length} KXWCGAME markets`);

  const byEvent = new Map<string, KMarket[]>();
  for (const m of markets) {
    const ev = m.event_ticker ?? '';
    if (!ev) continue;
    (byEvent.get(ev) ?? byEvent.set(ev, []).get(ev)!).push(m);
  }

  const out: KalshiEventQuotes[] = [];
  for (const [ev, ms] of byEvent) {
    const teams = ms.map((m) => m.yes_sub_title ?? '').filter((t) => t && !/^tie$/i.test(t));
    if (teams.length !== 2) continue;
    const fm = await matchEvent(teams[0]!, teams[1]!);
    if (!fm) continue;

    const quotes: NormQuote[] = [];
    for (const m of ms) {
      const p = buyPrice(m);
      if (p === undefined) continue;
      const label = m.yes_sub_title ?? '';
      let selection: Selection | undefined;
      if (/^tie$/i.test(label)) selection = 'draw';
      else {
        const n = normName(label);
        if (n && (n.includes(fm.fixture.homeKey) || fm.fixture.homeKey.includes(n))) selection = 'home';
        else if (n && (n.includes(fm.fixture.awayKey) || fm.fixture.awayKey.includes(n))) selection = 'away';
      }
      if (!selection) continue;

      const decimalOdds = 1 / p;
      quotes.push({
        venueId: 'kalshi',
        externalEventId: `${fm.fixture.matchId}:1x2:${selection}`,
        market: '1x2',
        selection,
        decimalOdds,
        impliedProb: impliedFromDecimal(decimalOdds),
        homeName: fm.fixture.homeName,
        awayName: fm.fixture.awayName,
        extra: {
          ticker: m.ticker,
          eventTicker: ev,
          price: p,
          fromLast: !(Number(m.yes_ask_dollars) > 0),
          liquidity: Number(m.liquidity_dollars) || 0,
          url: SERIES_URL,
        },
        raw: { yes_sub: label, ticker: m.ticker },
      });
    }
    if (quotes.length) out.push({ fixtureMatchId: fm.fixture.matchId, eventTicker: ev, quotes });
  }
  return out;
}
