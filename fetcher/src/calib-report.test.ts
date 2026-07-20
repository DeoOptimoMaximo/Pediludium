import { describe, expect, it } from 'vitest';
import {
  NAIVE_BRIER,
  NAIVE_LOGLOSS,
  type ScoredRow,
  buildFinalReport,
  commonSubset,
  modelReport,
  reliability,
  surprises,
} from './calib-report.ts';

/**
 * Guards on the final-reckoning aggregation (docs/21 §3A). The failure mode this protects
 * against is not a crash — it is a report that quietly flatters the model: comparing models
 * scored on different subsets, plotting reliability points backed by no data, or losing the
 * phase split. Each of those looks fine on screen and is wrong.
 */

/** Build a row with the given forecast and realised outcome, scored the way the exporter does. */
function row(match_id: number, p: number[], outcome: number, phase?: 'group' | 'ko'): ScoredRow {
  const brier = p.reduce((s, pi, i) => s + (pi - (i === outcome ? 1 : 0)) ** 2, 0);
  return {
    match_id,
    kickoff: `2026-06-${String(match_id).padStart(2, '0')}T18:00:00.000Z`,
    phase,
    p,
    outcome,
    brier,
    logloss: -Math.log(Math.max(p[outcome]!, 1e-9)),
  };
}

const THIRD = [1 / 3, 1 / 3, 1 / 3];

describe('naive baseline — the bar a model must clear to claim it knows anything', () => {
  it('matches the uniform guess actually scored through the same code path', () => {
    const rows = [row(1, THIRD, 0), row(2, THIRD, 1), row(3, THIRD, 2)];
    const rep = modelReport('uniform', rows);
    expect(rep.overall.brier).toBeCloseTo(NAIVE_BRIER, 4);
    expect(rep.overall.logloss).toBeCloseTo(NAIVE_LOGLOSS, 4);
  });

  it('scores a uniform forecaster at exactly zero skill', () => {
    const rep = modelReport('uniform', [row(1, THIRD, 0), row(2, THIRD, 2)]);
    expect(rep.skill).toBeCloseTo(0, 4);
  });

  it('reports negative skill for a model worse than guessing — never clamps it to zero', () => {
    // Confidently wrong every time. A report that floors this at 0 hides the worst outcome.
    const rep = modelReport('bad', [row(1, [0.9, 0.05, 0.05], 2), row(2, [0.9, 0.05, 0.05], 2)]);
    expect(rep.skill).toBeLessThan(0);
  });
});

describe('phase split — groups vs knockout', () => {
  const rows = [
    row(1, [0.6, 0.2, 0.2], 0, 'group'),
    row(2, [0.6, 0.2, 0.2], 0, 'group'),
    row(3, [0.2, 0.2, 0.6], 0, 'ko'), // knockout miss
  ];

  it('separates the phases and keeps each n alongside its score', () => {
    const rep = modelReport('m', rows);
    expect(rep.group!.n).toBe(2);
    expect(rep.ko!.n).toBe(1);
    expect(rep.overall.n).toBe(3);
    expect(rep.ko!.brier).toBeGreaterThan(rep.group!.brier);
  });

  it('returns null rather than a zero score for a phase with no rows', () => {
    // A 0.000 Brier for an unplayed phase would read as flawless prediction.
    const rep = modelReport('m', [row(1, [0.6, 0.2, 0.2], 0, 'group')]);
    expect(rep.ko).toBeNull();
    expect(rep.group).not.toBeNull();
  });

  it('tolerates rows from snapshots published before phase was recorded', () => {
    const rep = modelReport('m', [row(1, [0.6, 0.2, 0.2], 0)]);
    expect(rep.overall.n).toBe(1);
    expect(rep.group).toBeNull();
    expect(rep.ko).toBeNull();
  });
});

describe('reliability — does 30% mean 30%', () => {
  it('drops empty bins instead of plotting them at observed = 0', () => {
    const bins = reliability([row(1, [1, 0, 0], 0)], 5);
    expect(bins.every((b) => b.n > 0)).toBe(true);
    expect(bins.some((b) => b.lo === 0.8)).toBe(true); // the p=1 leg
  });

  it('keeps p = 1 inside the top bin rather than overflowing past it', () => {
    const bins = reliability([row(1, [1, 0, 0], 0)], 5);
    const top = bins.find((b) => b.hi === 1)!;
    expect(top.predicted).toBeCloseTo(1, 4);
    expect(top.observed).toBeCloseTo(1, 4);
  });

  it('pools all three legs per match, so n counts legs and not matches', () => {
    const bins = reliability([row(1, THIRD, 0), row(2, THIRD, 1)], 5);
    expect(bins.reduce((s, b) => s + b.n, 0)).toBe(6);
  });

  it('reads observed ≈ predicted for a perfectly calibrated forecaster', () => {
    // 12 matches at 50/25/25; home really wins half the time.
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1, [0.5, 0.25, 0.25], i % 2 === 0 ? 0 : 1));
    const bin = reliability(rows, 5).find((b) => b.lo === 0.4)!;
    expect(bin.observed).toBeCloseTo(bin.predicted, 1);
  });
});

describe('surprises — what the model saw coming least', () => {
  it('ranks by the probability given to what actually happened, lowest first', () => {
    const rows = [
      row(1, [0.8, 0.1, 0.1], 0), // expected
      row(2, [0.8, 0.1, 0.1], 2), // shock
      row(3, [0.5, 0.3, 0.2], 1),
    ];
    const s = surprises(rows, 2);
    expect(s.map((x) => x.match_id)).toEqual([2, 3]);
    expect(s[0]!.p_actual).toBeCloseTo(0.1, 4);
  });

  it('is deterministic when probabilities tie — ties break by kickoff, not array order', () => {
    const a = surprises([row(2, [0.8, 0.1, 0.1], 2), row(1, [0.8, 0.1, 0.1], 2)], 2);
    const b = surprises([row(1, [0.8, 0.1, 0.1], 2), row(2, [0.8, 0.1, 0.1], 2)], 2);
    expect(a.map((x) => x.match_id)).toEqual(b.map((x) => x.match_id));
  });
});

describe('commonSubset — the guard against comparing different subsets', () => {
  it('re-scores every model on only the matches all of them predicted', () => {
    // `late` joined the tournament after match 1 — comparing its 5-match average against
    // `full`'s 6-match average is the exact dishonesty this exists to prevent.
    const full = [1, 2, 3, 4, 5, 6].map((i) => row(i, [0.6, 0.2, 0.2], 0));
    const late = [2, 3, 4, 5, 6].map((i) => row(i, [0.6, 0.2, 0.2], 0));
    const common = commonSubset({ full, late })!;
    expect(common.n).toBe(5);
    expect(common.brier['full']).toBeCloseTo(common.brier['late']!, 4);
  });

  it('returns null when the overlap is too thin to mean anything', () => {
    const a = [1, 2, 3, 4, 5, 6].map((i) => row(i, THIRD, 0));
    const b = [row(6, THIRD, 0)];
    expect(commonSubset({ a, b })).toBeNull();
  });

  it('returns null for a single model — there is nothing to compare it to', () => {
    expect(commonSubset({ only: [1, 2, 3, 4, 5, 6].map((i) => row(i, THIRD, 0)) })).toBeNull();
  });
});

describe('buildFinalReport', () => {
  const good = [1, 2, 3, 4, 5, 6].map((i) => row(i, [0.7, 0.2, 0.1], 0, 'group'));
  const bad = [1, 2, 3, 4, 5, 6].map((i) => row(i, [0.1, 0.2, 0.7], 0, 'group'));

  it('ranks models by Brier, best first', () => {
    const rep = buildFinalReport({ bad, good });
    expect(rep.models.map((m) => m.version)).toEqual(['good', 'bad']);
  });

  it('counts distinct matches, not rows, so coverage is not inflated by model count', () => {
    const rep = buildFinalReport({ good, bad });
    expect(rep.matches).toBe(6);
  });

  it('carries an n on every aggregate it publishes', () => {
    const rep = buildFinalReport({ good, bad });
    for (const m of rep.models) {
      expect(m.overall.n).toBeGreaterThan(0);
      for (const b of m.reliability) expect(b.n).toBeGreaterThan(0);
    }
  });
});

describe('market coverage must not shrink the model-vs-model comparison', () => {
  // Regression: with the bookmaker in the same intersection, three models scored on 97 and
  // 104 matches were compared on 11 — a like-for-like set so thin it says nothing. The
  // market gets its own subset instead.
  const wide = (v: string) => Array.from({ length: 40 }, (_, i) => row(i + 1, [0.6, 0.2, 0.2], 0, 'group'));

  it('keeps `common` to our own models and puts the bookmaker in `vsMarket`', () => {
    const rep = buildFinalReport({
      'dixon-coles-v1': wide('a'),
      'baseline-poisson-elo-v1': wide('b'),
      'market-implied': [1, 2, 3, 4, 5, 6].map((i) => row(i, [0.6, 0.2, 0.2], 0, 'group')),
    });
    expect(rep.common!.n).toBe(40);
    expect(Object.keys(rep.common!.brier)).not.toContain('market-implied');
    expect(rep.vsMarket!.n).toBe(6);
    expect(Object.keys(rep.vsMarket!.brier)).toContain('market-implied');
  });

  it('omits vsMarket entirely when no odds were ever captured', () => {
    const rep = buildFinalReport({ 'dixon-coles-v1': wide('a'), 'baseline-poisson-elo-v1': wide('b') });
    expect(rep.vsMarket).toBeNull();
    expect(rep.common!.n).toBe(40);
  });
});
