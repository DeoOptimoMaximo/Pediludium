import { describe, expect, it } from 'vitest';
import { logOpinionPool, normalizeOutcome, ratesForOutcome } from './market-blend.ts';
import { dcScoreMatrix, outcomeProbs, type Outcome } from './model.ts';

const sum = (o: Outcome): number => o.pHome + o.pDraw + o.pAway;

describe('normalizeOutcome', () => {
  it('scales a triple to sum to 1', () => {
    const o = normalizeOutcome({ pHome: 2, pDraw: 1, pAway: 1 });
    expect(sum(o)).toBeCloseTo(1, 12);
    expect(o.pHome).toBeCloseTo(0.5, 12);
  });
  it('falls back to uniform on a degenerate (all-zero) input', () => {
    const o = normalizeOutcome({ pHome: 0, pDraw: 0, pAway: 0 });
    expect(o.pHome).toBeCloseTo(1 / 3, 12);
  });
});

describe('logOpinionPool', () => {
  const dc: Outcome = { pHome: 0.446, pDraw: 0.271, pAway: 0.282 }; // DC: Haiti favoured (absurd)
  const market: Outcome = { pHome: 0.0556, pDraw: 0.1889, pAway: 0.7556 }; // market: Scotland heavy

  it('always returns a normalized distribution', () => {
    for (const w of [0, 0.25, 0.5, 0.6, 0.75, 1]) {
      expect(sum(logOpinionPool(dc, market, w))).toBeCloseTo(1, 10);
    }
  });

  it('w=0 → pure (normalized) model, w=1 → pure (normalized) market', () => {
    const dcN = normalizeOutcome(dc);
    const mktN = normalizeOutcome(market);
    const m0 = logOpinionPool(dc, market, 0);
    expect(m0.pHome).toBeCloseTo(dcN.pHome, 6);
    const m1 = logOpinionPool(dc, market, 1);
    expect(m1.pHome).toBeCloseTo(mktN.pHome, 6);
    expect(m1.pAway).toBeCloseTo(mktN.pAway, 6);
  });

  it('clamps the market weight outside [0,1]', () => {
    const dcN = normalizeOutcome(dc);
    const mktN = normalizeOutcome(market);
    expect(logOpinionPool(dc, market, -5).pHome).toBeCloseTo(dcN.pHome, 6);
    expect(logOpinionPool(dc, market, 5).pAway).toBeCloseTo(mktN.pAway, 6);
  });

  it('kills the Haiti>Scotland absurdity: blend favours the market favourite', () => {
    const b = logOpinionPool(dc, market, 0.6);
    // DC had Haiti (home) ahead; after anchoring, Scotland (away) must lead.
    expect(b.pAway).toBeGreaterThan(b.pHome);
    expect(b.pAway).toBeGreaterThan(0.5);
    // still pulled toward DC vs pure market (not as extreme as 0.7556)
    expect(b.pAway).toBeLessThan(market.pAway);
    expect(b.pHome).toBeLessThan(dc.pHome);
  });

  it('Germany>Curaçao: blend lifts an under-rated favourite toward the market', () => {
    const dcG: Outcome = { pHome: 0.478, pDraw: 0.259, pAway: 0.263 };
    const mktG: Outcome = { pHome: 0.9115, pDraw: 0.0558, pAway: 0.0327 };
    const b = logOpinionPool(dcG, mktG, 0.6);
    expect(b.pHome).toBeGreaterThan(dcG.pHome);
    expect(b.pHome).toBeGreaterThan(0.7);
    expect(b.pAway).toBeLessThan(dcG.pAway);
  });

  it('a higher market weight moves the blend monotonically toward the market', () => {
    const lo = logOpinionPool(dc, market, 0.4);
    const hi = logOpinionPool(dc, market, 0.8);
    expect(hi.pAway).toBeGreaterThan(lo.pAway); // market favours away
    expect(hi.pHome).toBeLessThan(lo.pHome);
  });
});

describe('ratesForOutcome', () => {
  const rho = -0.05;

  it('recovers λ,μ that reproduce the target 1X2', () => {
    const target = outcomeProbs(dcScoreMatrix(1.7, 0.8, rho));
    const { lambda, mu } = ratesForOutcome(target, rho, { lambda: 1.3, mu: 1.3 });
    const got = outcomeProbs(dcScoreMatrix(lambda, mu, rho));
    expect(got.pHome).toBeCloseTo(target.pHome, 2);
    expect(got.pDraw).toBeCloseTo(target.pDraw, 2);
    expect(got.pAway).toBeCloseTo(target.pAway, 2);
  });

  it('produces coherent expected goals for a blended outcome (favourite scores more)', () => {
    const target: Outcome = { pHome: 0.15, pDraw: 0.25, pAway: 0.6 }; // away favoured
    const { lambda, mu } = ratesForOutcome(target, rho, { lambda: 1.4, mu: 1.0 });
    expect(mu).toBeGreaterThan(lambda); // away (favourite) expected to outscore home
    const got = outcomeProbs(dcScoreMatrix(lambda, mu, rho));
    expect(got.pAway).toBeGreaterThan(got.pHome);
  });

  it('stays within the rate bounds', () => {
    const target: Outcome = { pHome: 0.98, pDraw: 0.01, pAway: 0.01 };
    const { lambda, mu } = ratesForOutcome(target, rho, { lambda: 1.5, mu: 1.0 });
    expect(lambda).toBeGreaterThanOrEqual(0.05);
    expect(lambda).toBeLessThanOrEqual(6);
    expect(mu).toBeGreaterThanOrEqual(0.05);
    expect(mu).toBeLessThanOrEqual(6);
  });
});
