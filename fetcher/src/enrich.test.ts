import { describe, expect, it } from 'vitest';
import { parseOdds, parseStatistics, parseVotes, wantsEnrichment } from './enrich.ts';

/* Payloads mirror the SofaScore shapes (docs/02). We can't hit the live API in CI, and the
 * raw blob is persisted regardless — these guard the parsing of the few columns we extract. */

describe('parseStatistics', () => {
  it('pulls xG / possession / shots from the ALL period', () => {
    const raw = {
      statistics: [
        {
          period: 'ALL',
          groups: [
            { statisticsItems: [{ key: 'expectedGoals', homeValue: 1.85, awayValue: 0.92 }] },
            {
              statisticsItems: [
                { key: 'ballPossession', homeValue: 61, awayValue: 39 },
                { key: 'totalShotsOnGoal', homeValue: 14, awayValue: 7 },
                { key: 'shotsOnGoal', homeValue: 6, awayValue: 2 },
              ],
            },
          ],
        },
        { period: '1ST', groups: [] },
      ],
    };
    expect(parseStatistics(raw)).toEqual({
      xg_home: 1.85,
      xg_away: 0.92,
      possession_home: 61,
      possession_away: 39,
      shots_home: 14,
      shots_away: 7,
      shots_on_home: 6,
      shots_on_away: 2,
    });
  });

  it('returns nulls when statistics are absent', () => {
    expect(parseStatistics({ statistics: [] }).xg_home).toBeNull();
  });
});

describe('parseOdds', () => {
  it('normalizes 1X2 fractional odds into implied probs summing to 1 (overround removed)', () => {
    const raw = {
      markets: [
        {
          marketName: 'Full time',
          marketId: 1,
          choices: [
            { name: '1', fractionalValue: '4/6' }, // 1.667 dec
            { name: 'X', fractionalValue: '5/2' }, // 3.5 dec
            { name: '2', fractionalValue: '9/2' }, // 5.5 dec
          ],
        },
      ],
    };
    const o = parseOdds(raw);
    expect(o.imp_home! + o.imp_draw! + o.imp_away!).toBeCloseTo(1, 3); // each prob 4dp-rounded
    expect(o.imp_home).toBeGreaterThan(o.imp_draw!);
    expect(o.imp_draw).toBeGreaterThan(o.imp_away!);
  });

  it('returns nulls when the 1X2 market is missing a choice', () => {
    const o = parseOdds({ markets: [{ marketName: 'Full time', choices: [{ name: '1', fractionalValue: '1/2' }] }] });
    expect(o).toEqual({ imp_home: null, imp_draw: null, imp_away: null });
  });
});

describe('parseVotes', () => {
  it('maps vote1/voteX/vote2 to home/draw/away', () => {
    expect(parseVotes({ vote: { vote1: 1200, voteX: 300, vote2: 500 } })).toEqual({
      votes_home: 1200,
      votes_draw: 300,
      votes_away: 500,
    });
  });
});

describe('wantsEnrichment (tick planning)', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  const base = { stats_at: null, lineups_at: null, odds_at: null, votes_at: null, shotmap_at: null };

  it('captures odds + votes inside the pre-match window, no stats/shotmap yet', () => {
    const k = wantsEnrichment({ ...base, status_type: 'notstarted', start_ts: '2026-06-12T14:00:00Z' }, now);
    expect(k).toContain('odds');
    expect(k).toContain('votes');
    expect(k).not.toContain('statistics');
    expect(k).not.toContain('shotmap');
  });

  it('skips a far-future match entirely', () => {
    const k = wantsEnrichment({ ...base, status_type: 'notstarted', start_ts: '2026-06-20T14:00:00Z' }, now);
    expect(k).toEqual([]);
  });

  it('pulls stats + shotmap + lineups while live', () => {
    const k = wantsEnrichment({ ...base, status_type: 'inprogress', start_ts: '2026-06-12T11:00:00Z' }, now);
    expect(k).toEqual(expect.arrayContaining(['odds', 'votes', 'lineups', 'statistics', 'shotmap']));
  });

  it('re-captures a finished match once, then leaves final rows alone', () => {
    const fresh = wantsEnrichment({ ...base, status_type: 'finished', start_ts: '2026-06-12T09:00:00Z' }, now);
    expect(fresh).toEqual(expect.arrayContaining(['statistics', 'shotmap', 'lineups', 'odds', 'votes']));
    const done = wantsEnrichment(
      { status_type: 'finished', start_ts: '2026-06-12T09:00:00Z', stats_at: 'finished', lineups_at: 'finished', shotmap_at: 'finished', odds_at: 'finished', votes_at: 'finished' },
      now,
    );
    expect(done).toEqual([]);
  });
});
