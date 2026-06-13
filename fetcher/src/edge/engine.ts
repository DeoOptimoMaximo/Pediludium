import { config } from '../config.ts';
import { dbQuery } from '../db.ts';
import {
  insertOpportunity,
  loadMatchedQuotes,
  markOpenOpportunitiesStale,
  setQuoteFairProb,
  type QuoteRow,
} from './db.ts';
import type { MarketKind, Selection } from './types.ts';

/**
 * The math engine. For every matched fixture it:
 *  1. removes each venue's overround → fair_prob per selection (book's own view);
 *  2. detects +EV vs OUR model (dixon-coles-v1): edge = model_prob*odds - 1;
 *  3. detects cross-venue arbitrage: best odds per outcome; if Σ(1/odds) < 1 → locked profit.
 *
 * Model probabilities: 1x2 comes straight from public.prediction. Over/Under 2.5 is derived
 * from the DC expected goals (λ+μ) as a Poisson total — so totals get a real model edge too.
 */

const EV = config.edgeMinEv;
const ARB = config.edgeMinArb;
const MODEL = config.edgeModelVersion;

/** P(total goals > 2.5) for a Poisson with mean T = λ+μ. */
function poissonOver25(totalMean: number): number {
  const T = Math.max(0, totalMean);
  const p0 = Math.exp(-T);
  const p1 = p0 * T;
  const p2 = p1 * (T / 2);
  return 1 - (p0 + p1 + p2); // 1 - P(X<=2)
}

interface ModelProbs {
  home?: number;
  draw?: number;
  away?: number;
  over?: number;
  under?: number;
}

async function loadModelProbs(): Promise<Map<number, ModelProbs>> {
  const rows = await dbQuery<{
    match_id: string;
    p_home: number | null;
    p_draw: number | null;
    p_away: number | null;
    exp_home_goals: number | null;
    exp_away_goals: number | null;
  }>(
    `select match_id, p_home, p_draw, p_away, exp_home_goals, exp_away_goals
       from public.prediction where model_version=$1`,
    [MODEL],
  );
  const m = new Map<number, ModelProbs>();
  for (const r of rows) {
    const probs: ModelProbs = {
      home: r.p_home ?? undefined,
      draw: r.p_draw ?? undefined,
      away: r.p_away ?? undefined,
    };
    if (r.exp_home_goals != null && r.exp_away_goals != null) {
      const over = poissonOver25(r.exp_home_goals + r.exp_away_goals);
      probs.over = over;
      probs.under = 1 - over;
    }
    m.set(Number(r.match_id), probs);
  }
  return m;
}

/** Fractional, capped Kelly stake for prob p at decimal odds o. */
function kelly(p: number, o: number): number {
  if (o <= 1) return 0;
  const f = (p * o - 1) / (o - 1);
  return Math.max(0, Math.min(1, f)) * config.edgeKellyFraction;
}

type GroupKey = string; // `${matchId}:${market}`
const SEL_BY_MARKET: Record<MarketKind, Selection[]> = {
  '1x2': ['home', 'draw', 'away'],
  ou25: ['over', 'under'],
};

export interface ScanResult {
  fairWrites: number;
  evCount: number;
  arbCount: number;
}

export async function scan(): Promise<ScanResult> {
  const quotes = await loadMatchedQuotes();
  const model = await loadModelProbs();
  await markOpenOpportunitiesStale();

  // group quotes by (match, market, venue) for overround removal, and by (match, market) for arb
  const byMatchMarket = new Map<GroupKey, QuoteRow[]>();
  for (const q of quotes) {
    const k = `${q.match_id}:${q.market}`;
    (byMatchMarket.get(k) ?? byMatchMarket.set(k, []).get(k)!).push(q);
  }

  let fairWrites = 0;
  let evCount = 0;
  let arbCount = 0;

  for (const [key, group] of byMatchMarket) {
    const [matchIdStr, market] = key.split(':') as [string, MarketKind];
    const matchId = Number(matchIdStr);
    const sels = SEL_BY_MARKET[market];

    // 1) overround removal per venue (needs the full selection set for that venue).
    // Keep the no-vig fair prob in memory too — it's this scan's value (the stored
    // column is only updated below), and the longshot guard needs it immediately.
    const fairBySel = new Map<string, number>(); // `${venue}:${selection}` → fair prob
    const byVenue = new Map<string, QuoteRow[]>();
    for (const q of group) (byVenue.get(q.venue_id) ?? byVenue.set(q.venue_id, []).get(q.venue_id)!).push(q);
    for (const [, vq] of byVenue) {
      const present = sels.every((s) => vq.some((q) => q.selection === s));
      if (!present) continue;
      const overround = vq.reduce((sum, q) => sum + q.implied_prob, 0);
      if (overround <= 0) continue;
      for (const q of vq) {
        const fair = q.implied_prob / overround;
        fairBySel.set(`${q.venue_id}:${q.selection}`, fair);
        await setQuoteFairProb(q.venue_id, q.external_event_id, q.market, q.selection, fair);
        fairWrites++;
      }
    }

    // 2) +EV vs our model (uses raw odds you'd actually be paid), with longshot guards:
    // skip selections the market prices as a long outsider — there the model's tail is
    // unreliable and a huge "edge" is almost certainly miscalibration, not value.
    const mp = model.get(matchId);
    if (mp) {
      for (const q of group) {
        const p = mp[q.selection];
        if (p == null) continue;
        if (q.decimal_odds > config.edgeMaxEvOdds) continue;
        const marketFair = fairBySel.get(`${q.venue_id}:${q.selection}`);
        if (marketFair != null && marketFair < config.edgeMinMarketProb) continue;
        const edge = p * q.decimal_odds - 1;
        if (edge >= EV) {
          await insertOpportunity({
            kind: 'ev',
            matchId,
            market,
            selection: q.selection,
            venueId: q.venue_id,
            decimalOdds: q.decimal_odds,
            modelProb: p,
            modelVersion: MODEL,
            edge,
            kellyFraction: kelly(p, q.decimal_odds),
            raw: { implied: q.implied_prob, fair: q.fair_prob },
          });
          evCount++;
        }
      }
    }

    // 3) cross-venue arbitrage: best odds per selection, Σ(1/odds) < 1
    const best = new Map<Selection, { venue: string; odds: number }>();
    for (const q of group) {
      const cur = best.get(q.selection);
      if (!cur || q.decimal_odds > cur.odds) best.set(q.selection, { venue: q.venue_id, odds: q.decimal_odds });
    }
    if (sels.every((s) => best.has(s))) {
      const total = sels.reduce((sum, s) => sum + 1 / best.get(s)!.odds, 0);
      const profit = 1 / total - 1;
      // Require ≥2 venues: a single venue's "arb" is a midpoint artefact (you'd pay the
      // ask on every leg, not the mid), so it isn't actually executable.
      const distinctVenues = new Set(sels.map((s) => best.get(s)!.venue)).size;
      if (profit >= ARB && distinctVenues >= 2) {
        const legs = sels.map((s) => {
          const b = best.get(s)!;
          return { venue: b.venue, selection: s, odds: b.odds, stake_frac: 1 / b.odds / total };
        });
        await insertOpportunity({ kind: 'arb', matchId, market, edge: profit, legs, raw: { total } });
        arbCount++;
      }
    }
  }

  return { fairWrites, evCount, arbCount };
}
