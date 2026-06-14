import { describe, expect, it } from 'vitest';
import { parseResultMarkdown } from './refresh-firecrawl.ts';

// Representative slices of a real SofaScore match page rendered to markdown by Firecrawl
// (Australia 2-0 Türkiye, 2026-06-14) — the exact strings the parser must handle.
const FINISHED_MD = `
- # Australia vs Türkiye live score, H2H results, standings and prediction
Australia
Finished
Türkiye
Full-time
FT 2 - 0
HT 1 - 0
Match ends, Australia 2, Türkiye 0.
Second Half ends, Australia 2, Türkiye 0.
`;

const NOTSTARTED_MD = `
- # France vs Senegal live score, H2H results, standings and prediction
France
Senegal
France is going head to head with Senegal starting on 14 Jun 2026 at 19:00 UTC.
Lineups Statistics Standings H2H Media
AboutFootball live scores on Sofascore livescore has live coverage … fast and accurate
updates for minutes, scores, halftime and full time soccer results, goal scorers …
`;

const LIVE_MD = `
- # Spain vs Brazil live score
Spain
Brazil
67'
HT 1 - 0
`;

describe('parseResultMarkdown', () => {
  it('reads a finished match from the "Match ends" commentary (home-away order)', () => {
    const r = parseResultMarkdown(FINISHED_MD, 'Australia', 'Türkiye');
    expect(r).toEqual({ home_score: 2, away_score: 0, status: 'finished' });
  });

  it('does not confuse the HT score with the FT score', () => {
    // The "Match ends" line wins; result is the full-time 2-0, never the halftime 1-0.
    const r = parseResultMarkdown(FINISHED_MD, 'Australia', 'Türkiye');
    expect(r?.home_score).toBe(2);
    expect(r?.away_score).toBe(0);
  });

  it('falls back to "FT N - M" when the commentary line is absent', () => {
    const md = 'Belgium\nEgypt\nFull-time\nFT 3 - 1\nHT 2 - 0\n';
    const r = parseResultMarkdown(md, 'Belgium', 'Egypt');
    expect(r).toEqual({ home_score: 3, away_score: 1, status: 'finished' });
  });

  it('swaps the score when SofaScore lists the away team first in the commentary', () => {
    const md = 'Match ends, Türkiye 0, Australia 2.\nFull-time\n';
    const r = parseResultMarkdown(md, 'Australia', 'Türkiye'); // home=Australia, away=Türkiye
    expect(r).toEqual({ home_score: 2, away_score: 0, status: 'finished' });
  });

  it('handles multi-word and diacritic team names', () => {
    const md = "Match ends, Saudi Arabia 1, Côte d'Ivoire 2.\n";
    const r = parseResultMarkdown(md, 'Saudi Arabia', "Côte d'Ivoire");
    expect(r).toEqual({ home_score: 1, away_score: 2, status: 'finished' });
  });

  it('detects a not-started match', () => {
    const r = parseResultMarkdown(NOTSTARTED_MD, 'France', 'Senegal');
    expect(r?.status).toBe('notstarted');
    expect(r?.home_score).toBeNull();
  });

  it('is NOT tripped into "live" by the footer boilerplate (halftime/full time text)', () => {
    // Regression: the generic SofaScore footer mentions "halftime and full time" and
    // "minutes" on every page — must not read as in-progress on a not-started match.
    const r = parseResultMarkdown(NOTSTARTED_MD, 'France', 'Senegal');
    expect(r?.status).toBe('notstarted');
  });

  it('detects an in-progress match with the halftime score', () => {
    const r = parseResultMarkdown(LIVE_MD, 'Spain', 'Brazil');
    expect(r).toEqual({ home_score: 1, away_score: 0, status: 'inprogress' });
  });

  it('returns null on empty input', () => {
    expect(parseResultMarkdown('', 'A', 'B')).toBeNull();
  });
});
