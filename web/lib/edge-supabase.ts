import { supa } from './supabase';
import type {
  EdgeOpportunity,
  EdgePaperOrder,
  EdgeQuote,
  EdgeStats,
  EdgeWallet,
  MatchOddsBoard,
} from './edge-types';

/**
 * Edge-layer reads from Postgres directly via the anon client (RLS public-read) — the
 * local-dev backend. The public Cloudflare deploy uses edge-snapshot.ts instead.
 */

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

/** key `${venue_id}:${match_id}` → external market URL (verify link), any venue. */
export async function getVenueLinks(): Promise<Map<string, string>> {
  const { data, error } = await supa()
    .from('edge_quote')
    .select('venue_id, match_id, extra')
    .not('match_id', 'is', null);
  if (error) throw error;
  const m = new Map<string, string>();
  for (const q of (data ?? []) as { venue_id: string; match_id: number; extra: Record<string, unknown> | null }[]) {
    const url = q.extra?.url as string | undefined;
    if (url) m.set(`${q.venue_id}:${q.match_id}`, url);
  }
  return m;
}

export async function getMatchNames(): Promise<Map<number, { home: string; away: string }>> {
  const { data, error } = await supa().from('wc2026_match').select('ss_id, home_name, away_name');
  if (error) throw error;
  const m = new Map<number, { home: string; away: string }>();
  for (const r of (data ?? []) as { ss_id: number; home_name: string | null; away_name: string | null }[]) {
    m.set(r.ss_id, { home: r.home_name ?? '', away: r.away_name ?? '' });
  }
  return m;
}

/** Build the cross-venue 1X2 odds board for matches that have any quotes. */
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

export async function getEdgeStats(): Promise<EdgeStats> {
  const { count } = await supa().from('edge_quote').select('*', { count: 'exact', head: true });
  const { data } = await supa().from('edge_quote').select('venue_id');
  const venues = new Set((data ?? []).map((r: { venue_id: string }) => r.venue_id)).size;
  return { quotes: count ?? 0, venues };
}
