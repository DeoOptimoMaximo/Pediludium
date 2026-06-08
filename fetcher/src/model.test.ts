import { describe, expect, it } from 'vitest';
import {
  buildCdf,
  dcScoreMatrix,
  fitDixonColes,
  mulberry32,
  outcomeProbs,
  rates,
  sampleScore,
  tau,
  type DcMatch,
} from './model.ts';

describe('tau (Dixon-Coles low-score correction)', () => {
  it('only the four lowest scorelines differ from 1', () => {
    expect(tau(0, 0, 1.2, 0.9, -0.05)).toBeCloseTo(1 - 1.2 * 0.9 * -0.05, 10);
    expect(tau(0, 1, 1.2, 0.9, -0.05)).toBeCloseTo(1 + 1.2 * -0.05, 10);
    expect(tau(1, 0, 1.2, 0.9, -0.05)).toBeCloseTo(1 + 0.9 * -0.05, 10);
    expect(tau(1, 1, 1.2, 0.9, -0.05)).toBeCloseTo(1 - -0.05, 10);
    expect(tau(2, 1, 1.2, 0.9, -0.05)).toBe(1);
    expect(tau(3, 4, 1.2, 0.9, -0.05)).toBe(1);
  });
});

describe('dcScoreMatrix / outcomeProbs', () => {
  it('is a normalized probability distribution', () => {
    const m = dcScoreMatrix(1.4, 1.1, -0.06);
    let sum = 0;
    for (const row of m) for (const v of row) sum += v;
    expect(sum).toBeCloseTo(1, 6);
    const o = outcomeProbs(m);
    expect(o.pHome + o.pDraw + o.pAway).toBeCloseTo(1, 6);
  });

  it('a stronger attack shifts probability toward the home win', () => {
    const even = outcomeProbs(dcScoreMatrix(1.3, 1.3, -0.05));
    const homeStrong = outcomeProbs(dcScoreMatrix(2.1, 0.8, -0.05));
    expect(homeStrong.pHome).toBeGreaterThan(even.pHome);
    expect(homeStrong.pAway).toBeLessThan(even.pAway);
  });

  it('rho only nudges the low-score cells', () => {
    const a = dcScoreMatrix(1.2, 1.0, 0);
    const b = dcScoreMatrix(1.2, 1.0, -0.1);
    const a22 = a[2]![2]!;
    const b22 = b[2]![2]!;
    const a00 = a[0]![0]!;
    const b00 = b[0]![0]!;
    // the 2-2 cell is untouched by the correction, up to renormalization
    expect(Math.abs(a22 - b22) / a22).toBeLessThan(0.02);
    // 0-0 moves more than 2-2
    expect(Math.abs(a00 - b00)).toBeGreaterThan(Math.abs(a22 - b22));
  });
});

describe('fitDixonColes', () => {
  it('recovers attack ordering from synthetic results', () => {
    // Team 1 thrashes everyone, team 3 loses a lot; team 2 in between.
    const matches: DcMatch[] = [];
    const push = (h: number, a: number, hs: number, as: number) =>
      matches.push({ home: h, away: a, hs, as, ageDays: 30 });
    for (let r = 0; r < 12; r++) {
      push(1, 2, 3, 0);
      push(1, 3, 4, 0);
      push(2, 3, 2, 0);
      push(2, 1, 0, 2);
      push(3, 1, 0, 3);
      push(3, 2, 0, 1);
    }
    const fit = fitDixonColes(matches, { iterations: 300 });
    // strength = attack + defense (high defense param = suppresses opponents = good)
    const strength = (t: number) => (fit.attack.get(t) ?? 0) + (fit.defense.get(t) ?? 0);
    expect(strength(1)).toBeGreaterThan(strength(2));
    expect(strength(2)).toBeGreaterThan(strength(3));
    // home advantage should fit positive
    expect(fit.gamma).toBeGreaterThan(0);
    // and predicted λ for the dominant team is well above the weak one
    const r = rates(fit, 1, 3);
    expect(r.lambda).toBeGreaterThan(r.mu);
  });

  it('time decay makes recent form dominate', () => {
    // Old: team 1 strong. Recent: team 1 weak. Recent should win out.
    const matches: DcMatch[] = [];
    for (let r = 0; r < 10; r++) {
      matches.push({ home: 1, away: 2, hs: 4, as: 0, ageDays: 2000 }); // ancient
      matches.push({ home: 1, away: 2, hs: 0, as: 3, ageDays: 20 }); // fresh
    }
    const fit = fitDixonColes(matches, { iterations: 300, halfLifeDays: 200 });
    const r = rates(fit, 1, 2);
    expect(r.mu).toBeGreaterThan(r.lambda); // away (team 2) now stronger
  });
});

describe('sampleScore', () => {
  it('returns the only cell of a degenerate matrix', () => {
    const m = Array.from({ length: 3 }, () => [0, 0, 0]);
    m[2]![1] = 1;
    const cdf = buildCdf(m);
    const rng = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(sampleScore(cdf, rng)).toEqual([2, 1]);
  });

  it('roughly reproduces the matrix outcome split over many draws', () => {
    const m = dcScoreMatrix(1.6, 1.0, -0.05);
    const target = outcomeProbs(m);
    const cdf = buildCdf(m);
    const rng = mulberry32(7);
    let h = 0;
    let d = 0;
    let a = 0;
    const N = 40000;
    for (let i = 0; i < N; i++) {
      const [x, y] = sampleScore(cdf, rng);
      if (x > y) h++;
      else if (x === y) d++;
      else a++;
    }
    expect(h / N).toBeCloseTo(target.pHome, 1);
    expect(a / N).toBeCloseTo(target.pAway, 1);
  });
});

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});
