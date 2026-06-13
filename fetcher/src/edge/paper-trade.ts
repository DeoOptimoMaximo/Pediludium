import { config } from '../config.ts';
import { dbQuery } from '../db.ts';
import {
  adjustWallet,
  ensureWallet,
  hasOpenOrder,
  insertPaperOrder,
  loadOpenOpportunities,
  stakedSince,
  type OpenOpportunityRow,
} from './db.ts';

/**
 * DRY-RUN trading experiment (Phase 5). Consumes open +EV opportunities and opens
 * SIMULATED positions sized by fractional Kelly, with hard risk limits. Fills are
 * simulated against the REAL Polymarket order book (so slippage is real), but no funds
 * move and no order is ever signed/posted while EDGE_DRY_RUN is true (the default).
 *
 * The live path is intentionally a guarded stub: going live requires clob-client-v2 +
 * wallet credentials + pUSD approvals (see ARCHITECTURE / .env.example). We refuse to
 * place real orders here so the experiment can run safely end-to-end first.
 */

const WALLET_ID = 'paper';
const UA = 'pediludium-edge/0.1';

interface BookLevel {
  price: number;
  size: number;
}

/** Fetch the CLOB order book for a token; return asks ascending by price. */
async function fetchAsks(tokenId: string): Promise<BookLevel[]> {
  const url = new URL(config.pmClobHost + '/book');
  url.searchParams.set('token_id', tokenId);
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA } });
  if (!res.ok) return [];
  const body = (await res.json()) as { asks?: Array<{ price: string; size: string }> };
  const asks = (body.asks ?? [])
    .map((a) => ({ price: Number(a.price), size: Number(a.size) }))
    .filter((a) => a.price > 0 && a.size > 0)
    .sort((x, y) => x.price - y.price);
  return asks;
}

/** Walk the asks spending `stakeUsd`; return VWAP fill price + shares actually bought. */
function walkAsks(asks: BookLevel[], stakeUsd: number): { shares: number; avgPrice: number } {
  let budget = stakeUsd;
  let shares = 0;
  for (const lvl of asks) {
    const levelCost = lvl.price * lvl.size;
    if (levelCost <= budget) {
      shares += lvl.size;
      budget -= levelCost;
    } else {
      shares += budget / lvl.price;
      budget = 0;
      break;
    }
  }
  const spent = stakeUsd - budget;
  return { shares, avgPrice: shares > 0 ? spent / shares : 0 };
}

export interface TradeResult {
  considered: number;
  placed: number;
  skipped: number;
  haltedReason?: string;
}

export async function runPaperTrades(): Promise<TradeResult> {
  if (!config.edgeDryRun) {
    // Safety: the live path is a deliberate no-op until properly wired + reviewed.
    console.warn('[trade] EDGE_DRY_RUN=false requested but live trading is not enabled in code — refusing.');
    return { considered: 0, placed: 0, skipped: 0, haltedReason: 'live-disabled' };
  }

  const wallet = await ensureWallet(WALLET_ID, config.edgePaperBankrollUsd);
  const dayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString();
  let stakedToday = await stakedSince(dayStart);

  const opps = (await loadOpenOpportunities()).filter((o) => o.kind === 'ev');
  let placed = 0;
  let skipped = 0;

  for (const o of opps) {
    if (stakedToday >= config.edgeDailyLossLimitUsd) {
      console.warn(`[trade] daily exposure limit hit ($${config.edgeDailyLossLimitUsd}) — halting`);
      return { considered: opps.length, placed, skipped, haltedReason: 'daily-limit' };
    }
    const matchId = Number(o.match_id);
    const selection = o.selection!;
    if (await hasOpenOrder(matchId, o.market, selection)) {
      skipped++;
      continue;
    }

    // size: fractional Kelly × bankroll, hard-capped, with a $1 floor
    const kelly = o.kelly_fraction ?? 0;
    let stake = Math.min(kelly * wallet.balance_usd, config.edgeMaxStakeUsd);
    stake = Math.min(stake, config.edgeDailyLossLimitUsd - stakedToday);
    if (stake < 1) {
      skipped++;
      continue;
    }

    const requestedOdds = o.decimal_odds ?? 0;
    let simFillOdds = requestedOdds;
    let simShares: number | null = null;

    // simulate against the real book for Polymarket; books fill at quote (no depth feed)
    if (o.venue_id === 'polymarket') {
      const ext = await loadQuoteExtra(matchId, o.market, selection);
      const tokenId = ext?.tokenId as string | undefined;
      if (tokenId) {
        const asks = await fetchAsks(tokenId);
        const fill = walkAsks(asks, stake);
        if (fill.shares > 0 && fill.avgPrice > 0) {
          simFillOdds = 1 / fill.avgPrice;
          simShares = fill.shares;
        }
      }
    }

    const slippage = requestedOdds - simFillOdds;
    await insertPaperOrder({
      opportunityId: Number(o.id),
      venueId: o.venue_id!,
      matchId,
      market: o.market,
      selection,
      requestedOdds,
      modelProb: o.model_prob,
      stakeUsd: stake,
      simFillOdds,
      simSlippage: slippage,
      simShares,
      dryRun: true,
      status: 'simulated',
      raw: { edge: o.edge, kelly },
    });
    await adjustWallet(WALLET_ID, -stake); // money at risk; settlement credits the payout
    stakedToday += stake;
    placed++;
    console.log(
      `[trade] SIM buy ${o.market}/${selection} @ ${simFillOdds.toFixed(2)} (req ${requestedOdds.toFixed(2)}, slip ${slippage.toFixed(2)}) · $${stake.toFixed(2)} · match ${matchId}`,
    );
  }

  return { considered: opps.length, placed, skipped };
}

async function loadQuoteExtra(
  matchId: number,
  market: string,
  selection: string,
): Promise<Record<string, unknown> | null> {
  const rows = await dbQuery<{ extra: Record<string, unknown> | null }>(
    `select extra from public.edge_quote
       where venue_id='polymarket' and match_id=$1 and market=$2 and selection=$3`,
    [matchId, market, selection],
  );
  return rows[0]?.extra ?? null;
}

/**
 * Settle simulated orders whose match has finished. 1x2 by winner_code (1/2/3 = home/away/
 * draw), ou25 by total goals vs 2.5. Win credits stake×fill_odds back to the wallet; the
 * stake was already debited at placement, so net P&L = payout − stake.
 */
export async function settlePaperTrades(): Promise<{ settled: number; pnl: number }> {
  const rows = await dbQuery<{
    id: string;
    match_id: string;
    market: string;
    selection: string;
    stake_usd: number;
    sim_fill_odds: number | null;
    winner_code: number | null;
    home_score: number | null;
    away_score: number | null;
  }>(
    `select o.id, o.match_id, o.market, o.selection, o.stake_usd, o.sim_fill_odds,
            m.winner_code, m.home_score, m.away_score
       from public.edge_paper_order o
       join public.match m on m.ss_id = o.match_id
      where o.status='simulated' and m.status_type='finished'`,
  );

  let settled = 0;
  let pnlTotal = 0;
  for (const r of rows) {
    const odds = r.sim_fill_odds ?? 0;
    let won = false;
    if (r.market === '1x2') {
      const code = r.selection === 'home' ? 1 : r.selection === 'away' ? 2 : 3;
      won = r.winner_code === code;
    } else if (r.market === 'ou25' && r.home_score != null && r.away_score != null) {
      const total = r.home_score + r.away_score;
      won = r.selection === 'over' ? total >= 3 : total <= 2;
    }
    const payout = won ? r.stake_usd * odds : 0;
    const pnl = payout - r.stake_usd;
    await dbQuery(
      `update public.edge_paper_order set status='settled', pnl_usd=$2, settled_at=now() where id=$1`,
      [Number(r.id), pnl],
    );
    if (payout > 0) await adjustWallet(WALLET_ID, payout);
    pnlTotal += pnl;
    settled++;
  }
  return { settled, pnl: pnlTotal };
}
