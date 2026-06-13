import type { Browser } from 'playwright-core';
import { chromium } from 'playwright-core';
import { config } from '../config.ts';
import type { NormQuote, Selection } from './types.ts';
import { impliedFromDecimal } from './types.ts';
import { matchEvent } from './match-link.ts';

/**
 * SuperSport (Croatia's largest book, in-house platform) odds ingest.
 *
 * SuperSport doesn't serve odds over REST — its SPA opens a WebSocket `wss://…/api/sbk`
 * and the offer streams as frames in a custom format: `<headerJSON>\n<bodyJSON>`. The
 * `i_hr` channel pushes one ~1.25 MB snapshot (the whole HR offer tree
 * B→S(sport)→C(category)→T(tournament)→FX(fixture)) followed by incremental `P` price
 * updates. We drive the football page through the proxied Chrome (Croatian cellular IP),
 * capture the frames, rebuild the fixture tree + price state, and read 1X2.
 *
 * Decoded model (verified 2026-06-13 against live odds):
 *   fixture FX[id] = { H:{i,n}, A:{i,n}, sid, t, a:{ "1m<sid>":1 } }   (no odds inline)
 *   price key      = `1m<sid>` ; P[key].m["1"] = market "regularno vrijeme" (full-time 1X2)
 *   line.o         = { "1":{O}, "2":{O}, "3":{O} }  →  home / draw / away
 * Team names are Croatian (Njemačka, Maroko…) — match-link.ts carries the HR→EN aliases.
 */

const FOOTBALL_URL = 'https://www.supersport.hr/sport/day/6/sport/1';
const VERIFY_URL = 'https://www.supersport.hr/sport'; // per-match deep link isn't exposed
const CAPTURE_MS = 20_000;

interface Frame {
  header: { s?: string } | null;
  body: any;
}

function parseFrame(raw: string): Frame {
  const nl = raw.indexOf('\n');
  if (nl < 0) return { header: null, body: null };
  try {
    return { header: JSON.parse(raw.slice(0, nl)), body: JSON.parse(raw.slice(nl + 1)) };
  } catch {
    return { header: null, body: null };
  }
}

/** Drive the football page and collect raw api/sbk WS frames for CAPTURE_MS. */
async function captureFrames(): Promise<string[]> {
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: process.env.SOFA_HEADLESS === '1',
      ...(config.proxyServer ? { proxy: { server: config.proxyServer } } : {}),
    });
    const ctx = await browser.newContext({ locale: 'hr-HR' });
    const page = await ctx.newPage();
    const raw: string[] = [];
    page.on('websocket', (ws) => {
      if (!/\/api\/sbk/.test(ws.url())) return;
      ws.on('framereceived', (f) => {
        raw.push(typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8'));
      });
    });
    await page.goto(FOOTBALL_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, CAPTURE_MS));
    return raw;
  } finally {
    if (browser) await browser.close();
  }
}

interface SsFixture {
  sid: number;
  home: string;
  away: string;
}

/** Rebuild football fixtures + 1X2 odds from captured frames. */
function decode(frames: string[]): { fixtures: SsFixture[]; price: Record<string, any> } {
  const parsed = frames.map(parseFrame);
  // accumulate incremental price state (later frames override / extend earlier)
  const price: Record<string, any> = {};
  for (const { body } of parsed) {
    if (body && body.P) {
      for (const k of Object.keys(body.P)) {
        if (body.P[k] == null) continue;
        price[k] = Object.assign(price[k] || {}, body.P[k]);
      }
    }
  }
  // football fixture tree from the i_hr snapshot
  const snap = parsed.find((f) => f.header?.s === 'i_hr' && f.body?.B?.S?.['1']);
  const fixtures: SsFixture[] = [];
  const football = snap?.body?.B?.S?.['1'];
  for (const ck of Object.keys(football?.C ?? {})) {
    const T = football.C[ck].T ?? {};
    for (const tk of Object.keys(T)) {
      const FX = T[tk].FX ?? {};
      for (const fk of Object.keys(FX)) {
        const fx = FX[fk];
        if (fx?.H?.n && fx?.A?.n && fx?.sid) {
          fixtures.push({ sid: fx.sid, home: fx.H.n, away: fx.A.n });
        }
      }
    }
  }
  return { fixtures, price };
}

export interface SsEventQuotes {
  fixtureMatchId: number;
  quotes: NormQuote[];
}

export async function collectSupersportQuotes(framesOverride?: string[]): Promise<SsEventQuotes[]> {
  const frames = framesOverride ?? (await captureFrames());
  console.log(`[supersport] captured ${frames.length} WS frames`);
  const { fixtures, price } = decode(frames);
  console.log(`[supersport] decoded ${fixtures.length} football fixtures`);

  const out: SsEventQuotes[] = [];
  for (const f of fixtures) {
    const key = `1m${f.sid}`;
    const m1 = price[key]?.m?.['1']?.l; // market "1" = full-time 1X2
    if (!m1) continue;
    const line = m1[Object.keys(m1)[0]!];
    const o = line?.o;
    const odds = {
      home: o?.['1']?.O as number | undefined,
      draw: o?.['2']?.O as number | undefined,
      away: o?.['3']?.O as number | undefined,
    };
    if (!(odds.home && odds.draw && odds.away)) continue;

    const fm = await matchEvent(f.home, f.away);
    if (!fm) continue;

    const quotes: NormQuote[] = (['home', 'draw', 'away'] as Selection[]).map((sel) => {
      const decimalOdds = odds[sel as 'home' | 'draw' | 'away']!;
      return {
        venueId: 'supersport',
        externalEventId: `${fm.fixture.matchId}:1x2:${sel}`,
        market: '1x2',
        selection: sel,
        decimalOdds,
        impliedProb: impliedFromDecimal(decimalOdds),
        homeName: fm.fixture.homeName,
        awayName: fm.fixture.awayName,
        extra: { sid: f.sid, ssHome: f.home, ssAway: f.away, url: VERIFY_URL },
        raw: { sid: f.sid, o },
      };
    });
    out.push({ fixtureMatchId: fm.fixture.matchId, quotes });
  }
  return out;
}
