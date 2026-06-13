import type { BookAdapter } from './types.ts';
import type { NormQuote } from '../types.ts';

/**
 * Adapter registry. Endpoint patterns are the recon's best inferences; `parse` for each
 * book stays a calibration stub (returns []) until a discovery run pins the real payload
 * — at which point only the `parse` body changes. SuperSport / PSK / Favbet are the
 * priority targets (largest + cleanest JSON feeds).
 */

const notCalibrated =
  (id: string) =>
  (_body: unknown, _url: string): NormQuote[] => {
    void _body;
    void _url;
    // calibration TODO: map this book's offer JSON → 1x2 / ou25 NormQuotes (see docs/16)
    return [];
  };

export const BOOKS: BookAdapter[] = [
  {
    id: 'supersport',
    displayName: 'SuperSport',
    entryUrl: 'https://www.supersport.hr/sportske-kladionice/nogomet',
    offerPattern: /\/(api|offer|prematch|sportsbook|events?)\b.*\.?(json)?/i,
    parse: notCalibrated('supersport'),
  },
  {
    id: 'psk',
    displayName: 'PSK',
    entryUrl: 'https://www.psk.hr/sport/nogomet',
    offerPattern: /\/(api|offer|prematch|events?|feed)\b/i,
    parse: notCalibrated('psk'),
  },
  {
    id: 'favbet',
    displayName: 'Favbet',
    entryUrl: 'https://www.favbet.hr/hr/sports/#/sport/1/',
    offerPattern: /\/(api|feed|prematch|events?)\b/i,
    parse: notCalibrated('favbet'),
  },
  {
    id: 'germania',
    displayName: 'Germania',
    entryUrl: 'https://www.germaniasport.hr/ponuda/nogomet',
    offerPattern: /\/(api|offer|events?)\b/i,
    parse: notCalibrated('germania'),
  },
  {
    id: 'crobet',
    displayName: 'CroBet (Hrvatska Lutrija)',
    entryUrl: 'https://www.lutrija.hr/crobet?game=sport',
    offerPattern: /\/(api|offer|events?|sport)\b/i,
    parse: notCalibrated('crobet'),
  },
];
