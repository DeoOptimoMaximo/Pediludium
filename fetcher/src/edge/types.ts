/**
 * Edge layer shared types. Every venue (Polymarket onchain, HR sportsbooks offchain,
 * sharp-consensus) normalizes its prices into a `NormQuote`, which the engine compares
 * across venues and against our own model predictions. Kept deliberately small — the
 * union markets/selections match the SQL `market`/`selection` text columns 1:1.
 */

/** Markets we normalize for cross-venue comparison. */
export type MarketKind = '1x2' | 'ou25';

/** Selections within a market. 1x2 → home/draw/away; ou25 → over/under (line 2.5). */
export type Selection = 'home' | 'draw' | 'away' | 'over' | 'under';

export const SELECTIONS_1X2: Selection[] = ['home', 'draw', 'away'];
export const SELECTIONS_OU: Selection[] = ['over', 'under'];

/** A single normalized price from one venue for one selection of one event/market. */
export interface NormQuote {
  venueId: string;
  externalEventId: string; // PM conditionId / book event id
  market: MarketKind;
  selection: Selection;
  decimalOdds: number; // e.g. 1.538
  impliedProb: number; // 1/decimalOdds (raw, includes overround/vig)
  homeName?: string; // venue's own team naming, used to match to our fixtures
  awayName?: string;
  startTs?: string; // ISO, when the venue exposes it
  extra?: Record<string, unknown>; // e.g. { tokenId, bestAsk, bidSize } for PM
  raw?: unknown;
}

/** Decimal odds → implied probability (with vig). */
export function impliedFromDecimal(decimalOdds: number): number {
  return decimalOdds > 0 ? 1 / decimalOdds : 0;
}

/** Probability (0..1) → decimal odds. */
export function decimalFromProb(prob: number): number {
  return prob > 0 ? 1 / prob : Infinity;
}
