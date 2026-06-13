/**
 * Shared edge-layer view types. Used by both backends (edge-supabase.ts reads Postgres in
 * dev; edge-snapshot.ts reads the `edge` Workers KV blob in prod) and re-exported by the
 * lib/edge.ts facade — mirrors the data.ts / data-supabase.ts / data-snapshot.ts split.
 */

export interface EdgeQuote {
  venue_id: string;
  match_id: number | null;
  market: string;
  selection: string;
  home_name: string | null;
  away_name: string | null;
  decimal_odds: number;
  implied_prob: number;
  fair_prob: number | null;
}

export interface EdgeOpportunity {
  id: number;
  kind: 'ev' | 'arb';
  match_id: number;
  market: string;
  selection: string | null;
  venue_id: string | null;
  decimal_odds: number | null;
  model_prob: number | null;
  edge: number;
  kelly_fraction: number | null;
  legs: unknown;
  detected_at: string;
}

export interface EdgePaperOrder {
  id: number;
  venue_id: string;
  match_id: number | null;
  market: string;
  selection: string;
  requested_odds: number;
  stake_usd: number;
  sim_fill_odds: number | null;
  sim_slippage: number | null;
  dry_run: boolean;
  status: string;
  pnl_usd: number | null;
  placed_at: string;
}

export interface EdgeWallet {
  id: string;
  kind: string;
  balance_usd: number;
  starting_usd: number;
  currency: string;
}

/** A fixture's odds gathered across venues, for the Web2↔Web3 comparison table. */
export interface MatchOddsBoard {
  match_id: number;
  home_name: string;
  away_name: string;
  venues: Record<string, Partial<Record<string, number>>>;
}

/** One arbitrage leg as stored in edge_opportunity.legs. */
export interface ArbLeg {
  venue: string;
  selection: string;
  odds: number;
  stake_frac: number;
}

/** Polymarket per-selection info for building verify-links + showing the market price. */
export interface PmQuoteInfo {
  slug: string | null;
  price: number | null;
  odds: number;
}

export interface EdgeStats {
  quotes: number;
  venues: number;
}
