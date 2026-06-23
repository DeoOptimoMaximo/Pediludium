import { dbQuery } from '../db.ts';
import type { MarketKind, NormQuote, Selection } from './types.ts';

/**
 * Edge-layer DB writers/readers. Reuses the shared pg pool + upsert convention from
 * ../db.ts. The fetcher stays the only writer; raw payloads are always preserved.
 */

/** Upsert a batch of normalized quotes (latest snapshot per venue/event/market/selection). */
export async function upsertQuote(q: NormQuote, matchId: number | null): Promise<void> {
  await dbQuery(
    `insert into public.edge_quote
       (venue_id, external_event_id, market, selection, match_id, home_name, away_name,
        start_ts, decimal_odds, implied_prob, extra, raw, captured_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now(), now())
     on conflict (venue_id, external_event_id, market, selection) do update set
       match_id=excluded.match_id, home_name=excluded.home_name, away_name=excluded.away_name,
       start_ts=excluded.start_ts, decimal_odds=excluded.decimal_odds,
       implied_prob=excluded.implied_prob, extra=excluded.extra, raw=excluded.raw,
       updated_at=now()`,
    [
      q.venueId,
      q.externalEventId,
      q.market,
      q.selection,
      matchId,
      q.homeName ?? null,
      q.awayName ?? null,
      q.startTs ?? null,
      q.decimalOdds,
      q.impliedProb,
      q.extra ? JSON.stringify(q.extra) : null,
      q.raw ? JSON.stringify(q.raw) : null,
    ],
  );
}

/** Set the overround-removed fair probability once the engine computes it. */
export async function setQuoteFairProb(
  venueId: string,
  externalEventId: string,
  market: string,
  selection: string,
  fairProb: number,
): Promise<void> {
  await dbQuery(
    `update public.edge_quote set fair_prob=$5, updated_at=now()
       where venue_id=$1 and external_event_id=$2 and market=$3 and selection=$4`,
    [venueId, externalEventId, market, selection, fairProb],
  );
}

export interface QuoteRow {
  venue_id: string;
  external_event_id: string;
  market: MarketKind;
  selection: Selection;
  match_id: string | null;
  home_name: string | null;
  away_name: string | null;
  start_ts: string | null;
  decimal_odds: number;
  implied_prob: number;
  fair_prob: number | null;
  extra: Record<string, unknown> | null;
}

/**
 * Quotes for matched events that HAVEN'T kicked off yet (match_id set, start_ts in the
 * future). An edge only exists on a bet you can still place — once a fixture starts, its
 * prematch 1x2/ou25 markets are void for us, so we never scan, price, or stake them.
 */
export async function loadMatchedQuotes(): Promise<QuoteRow[]> {
  return dbQuery<QuoteRow>(
    `select q.venue_id, q.external_event_id, q.market, q.selection, q.match_id, q.home_name,
            q.away_name, q.start_ts, q.decimal_odds, q.implied_prob, q.fair_prob, q.extra
       from public.edge_quote q
       join public.match m on m.ss_id = q.match_id
      where q.match_id is not null
        and m.start_ts > now()`,
  );
}

export interface OpportunityInput {
  kind: 'ev' | 'arb';
  matchId: number;
  market: string;
  selection?: string | null;
  venueId?: string | null;
  decimalOdds?: number | null;
  modelProb?: number | null;
  modelVersion?: string | null;
  edge: number;
  kellyFraction?: number | null;
  legs?: unknown;
  raw?: unknown;
}

export async function insertOpportunity(o: OpportunityInput): Promise<number> {
  const rows = await dbQuery<{ id: string }>(
    `insert into public.edge_opportunity
       (kind, match_id, market, selection, venue_id, decimal_odds, model_prob, model_version,
        edge, kelly_fraction, legs, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [
      o.kind,
      o.matchId,
      o.market,
      o.selection ?? null,
      o.venueId ?? null,
      o.decimalOdds ?? null,
      o.modelProb ?? null,
      o.modelVersion ?? null,
      o.edge,
      o.kellyFraction ?? null,
      o.legs ? JSON.stringify(o.legs) : null,
      o.raw ? JSON.stringify(o.raw) : null,
    ],
  );
  return Number(rows[0]!.id);
}

/** Mark all currently-open opportunities stale before a fresh scan writes new ones. */
export async function markOpenOpportunitiesStale(): Promise<void> {
  await dbQuery(`update public.edge_opportunity set status='stale' where status='open'`);
}

export interface OpenOpportunityRow {
  id: string;
  kind: 'ev' | 'arb';
  match_id: string;
  market: string;
  selection: string | null;
  venue_id: string | null;
  decimal_odds: number | null;
  model_prob: number | null;
  edge: number;
  kelly_fraction: number | null;
  legs: unknown;
}

export async function loadOpenOpportunities(): Promise<OpenOpportunityRow[]> {
  return dbQuery<OpenOpportunityRow>(
    `select id, kind, match_id, market, selection, venue_id, decimal_odds, model_prob,
            edge, kelly_fraction, legs
       from public.edge_opportunity
      where status='open'
      order by edge desc`,
  );
}

/* ── wallet + paper orders ─────────────────────────────────────────────────── */

export interface WalletRow {
  id: string;
  kind: string;
  balance_usd: number;
  starting_usd: number;
  currency: string;
}

/** Get the wallet, seeding it on first use. */
export async function ensureWallet(id: string, seedUsd: number): Promise<WalletRow> {
  const existing = await dbQuery<WalletRow>(
    `select id, kind, balance_usd, starting_usd, currency from public.edge_wallet where id=$1`,
    [id],
  );
  if (existing.length) return existing[0]!;
  const kind = id === 'live' ? 'live' : 'paper';
  await dbQuery(
    `insert into public.edge_wallet (id, kind, balance_usd, starting_usd) values ($1,$2,$3,$3)
     on conflict (id) do nothing`,
    [id, kind, seedUsd],
  );
  return { id, kind, balance_usd: seedUsd, starting_usd: seedUsd, currency: 'USDC' };
}

export async function adjustWallet(id: string, deltaUsd: number): Promise<void> {
  await dbQuery(
    `update public.edge_wallet set balance_usd = balance_usd + $2, updated_at=now() where id=$1`,
    [id, deltaUsd],
  );
}

export interface PaperOrderInput {
  opportunityId: number | null;
  venueId: string;
  matchId: number | null;
  market: string;
  selection: string;
  side?: string;
  requestedOdds: number;
  modelProb?: number | null;
  stakeUsd: number;
  simFillOdds?: number | null;
  simSlippage?: number | null;
  simShares?: number | null;
  dryRun: boolean;
  status?: string;
  raw?: unknown;
}

export async function insertPaperOrder(o: PaperOrderInput): Promise<number> {
  const rows = await dbQuery<{ id: string }>(
    `insert into public.edge_paper_order
       (opportunity_id, venue_id, match_id, market, selection, side, requested_odds, model_prob,
        stake_usd, sim_fill_odds, sim_slippage, sim_shares, dry_run, status, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     returning id`,
    [
      o.opportunityId,
      o.venueId,
      o.matchId,
      o.market,
      o.selection,
      o.side ?? 'buy',
      o.requestedOdds,
      o.modelProb ?? null,
      o.stakeUsd,
      o.simFillOdds ?? null,
      o.simSlippage ?? null,
      o.simShares ?? null,
      o.dryRun,
      o.status ?? 'simulated',
      o.raw ? JSON.stringify(o.raw) : null,
    ],
  );
  return Number(rows[0]!.id);
}

/** Stake already committed today (UTC), for the daily-loss / exposure guard. */
export async function stakedSince(sinceIso: string): Promise<number> {
  const rows = await dbQuery<{ total: number | null }>(
    `select coalesce(sum(stake_usd),0) as total from public.edge_paper_order where placed_at >= $1`,
    [sinceIso],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Open positions already taken for a match+selection, to avoid stacking duplicates. */
export async function hasOpenOrder(matchId: number, market: string, selection: string): Promise<boolean> {
  const rows = await dbQuery<{ n: string }>(
    `select count(*) as n from public.edge_paper_order
       where match_id=$1 and market=$2 and selection=$3 and status in ('simulated','settled')`,
    [matchId, market, selection],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}
