import type { NormQuote } from '../types.ts';

/**
 * Croatian sportsbook (Web2) adapter contract. Each book is a SPA that loads its football
 * offer via internal JSON XHR; we harvest those responses through the same proxied Chrome
 * used for SofaScore. Per the recon, the exact endpoint paths are inferred and must be
 * calibrated live — so adapters run in `discover` mode first (log the candidate odds XHRs),
 * then graduate to parsing once the real payload shape is pinned.
 *
 * Vendor map (confirmed): SuperSport=in-house · PSK=Fortuna · Favbet=Betinvest ·
 * Germania=EGT content · CroBet=Hrvatska Lutrija (lutrija.hr/crobet).
 */
export interface BookAdapter {
  id: string; // edge_venue.id
  displayName: string;
  /** SPA entry URL whose XHR we harvest. */
  entryUrl: string;
  /** Regex over response URLs that likely carry the football offer JSON. */
  offerPattern: RegExp;
  /** Parse a harvested JSON body into normalized quotes (calibrated per book). */
  parse(body: unknown, sourceUrl: string): NormQuote[];
}

export interface BookCollectResult {
  venueId: string;
  quotes: NormQuote[];
  discovered: string[]; // candidate endpoint URLs seen (discovery aid)
}
