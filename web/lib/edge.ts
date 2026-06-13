import * as snapshot from './edge-snapshot';
import * as supabase from './edge-supabase';

/**
 * Edge-layer data facade — mirrors lib/data.ts. Two interchangeable backends:
 *   - supabase (default): local dev, reads Postgres directly (edge-supabase.ts)
 *   - snapshot: public Cloudflare deploy, reads the `edge` Workers KV blob (edge-snapshot.ts)
 * NEXT_PUBLIC_DATA_SOURCE is inlined at build time, so each build bakes in one backend.
 */
export const isSnapshot = process.env.NEXT_PUBLIC_DATA_SOURCE === 'snapshot';

const impl = isSnapshot ? snapshot : supabase;

export const getEdgeStats = impl.getEdgeStats;
export const getWallet = impl.getWallet;
export const getOpenOpportunities = impl.getOpenOpportunities;
export const getPaperOrders = impl.getPaperOrders;
export const getOddsBoard = impl.getOddsBoard;
export const getMatchNames = impl.getMatchNames;
export const getVenueLinks = impl.getVenueLinks;

export type {
  EdgeQuote,
  EdgeOpportunity,
  EdgePaperOrder,
  EdgeWallet,
  MatchOddsBoard,
  ArbLeg,
  PmQuoteInfo,
  EdgeStats,
} from './edge-types';
