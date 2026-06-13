import { supa } from './supabase';

/**
 * Edge-layer reads (Web2↔Web3 odds, +EV/arb opportunities, dry-run wallet/trades).
 * Isolated from the snapshot facade on purpose — this is a live dev dashboard that reads
 * Postgres directly via the anon client (RLS public-read), so it never touches the KV
 * snapshot path. The /edge page is force-dynamic.
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
  // venue → selection → decimal odds
  venues: Record<string, Partial<Record<string, number>>>;
}

export async function getOpenOpportunities(): Promise<EdgeOpportunity[]> {
  const { data, error } = await supa()
    .from('edge_opportunity')
    .select('*')
    .eq('status', 'open')
    .order('edge', { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []) as EdgeOpportunity[];
}

export async function getPaperOrders(limit = 25): Promise<EdgePaperOrder[]> {
  const { data, error } = await supa()
    .from('edge_paper_order')
    .select('*')
    .order('placed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as EdgePaperOrder[];
}

export async function getWallet(): Promise<EdgeWallet | null> {
  const { data, error } = await supa().from('edge_wallet').select('*').eq('id', 'paper').maybeSingle();
  if (error) throw error;
  return (data as EdgeWallet) ?? null;
}

/** Build the cross-venue odds board for matches that have any quotes. */
export async function getOddsBoard(): Promise<MatchOddsBoard[]> {
  const { data, error } = await supa()
    .from('edge_quote')
    .select('match_id, market, selection, venue_id, decimal_odds, home_name, away_name')
    .not('match_id', 'is', null)
    .eq('market', '1x2');
  if (error) throw error;
  const boards = new Map<number, MatchOddsBoard>();
  for (const q of (data ?? []) as EdgeQuote[]) {
    if (q.match_id == null) continue;
    const b =
      boards.get(q.match_id) ??
      boards
        .set(q.match_id, {
          match_id: q.match_id,
          home_name: q.home_name ?? '',
          away_name: q.away_name ?? '',
          venues: {},
        })
        .get(q.match_id)!;
    (b.venues[q.venue_id] ??= {})[q.selection] = q.decimal_odds;
  }
  return [...boards.values()].sort((a, b) => a.home_name.localeCompare(b.home_name));
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
  price: number | null; // 0..1 (the YES price)
  odds: number;
}

/** key `${match_id}:${market}:${selection}` → Polymarket slug/price/odds. */
export async function getPmIndex(): Promise<Map<string, PmQuoteInfo>> {
  const { data, error } = await supa()
    .from('edge_quote')
    .select('match_id, market, selection, decimal_odds, extra')
    .eq('venue_id', 'polymarket')
    .not('match_id', 'is', null);
  if (error) throw error;
  const m = new Map<string, PmQuoteInfo>();
  for (const q of (data ?? []) as (EdgeQuote & { extra: Record<string, unknown> | null })[]) {
    const ex = q.extra ?? {};
    m.set(`${q.match_id}:${q.market}:${q.selection}`, {
      slug: (ex.eventSlug as string) ?? null,
      price: ex.price != null ? Number(ex.price) : null,
      odds: q.decimal_odds,
    });
  }
  return m;
}

/** match_id → team names, for showing fixtures instead of raw ids. */
export async function getMatchNames(): Promise<Map<number, { home: string; away: string }>> {
  const { data, error } = await supa().from('wc2026_match').select('ss_id, home_name, away_name');
  if (error) throw error;
  const m = new Map<number, { home: string; away: string }>();
  for (const r of (data ?? []) as { ss_id: number; home_name: string | null; away_name: string | null }[]) {
    m.set(r.ss_id, { home: r.home_name ?? '', away: r.away_name ?? '' });
  }
  return m;
}

export async function getEdgeStats(): Promise<{ quotes: number; venues: number }> {
  const { count } = await supa().from('edge_quote').select('*', { count: 'exact', head: true });
  const { data } = await supa().from('edge_quote').select('venue_id');
  const venues = new Set((data ?? []).map((r: { venue_id: string }) => r.venue_id)).size;
  return { quotes: count ?? 0, venues };
}
