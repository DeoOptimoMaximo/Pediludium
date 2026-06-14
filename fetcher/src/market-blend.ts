/**
 * Market-anchored blend for the Dixon-Coles predictor (docs/08 #4) — pure math, no IO.
 *
 * The form-based Dixon-Coles fit has no opponent-strength term, so it produces absurd
 * predictions when two teams from different confederations meet (it predicted Morocco >
 * Brazil and Haiti > Scotland; reality was 1-1 and 0-1). The betting market aggregates all
 * of that missing information into a de-vigged 1X2 prior. We anchor the model to it with a
 * **log opinion pool** (a.k.a. logarithmic pooling / geometric mean of distributions):
 *
 *     P_i ∝ M_i^w · D_i^(1-w)
 *
 * where M is the market-implied outcome, D is the Dixon-Coles outcome and w ∈ [0,1] is the
 * market weight. This is the Bayesian-flavoured combination: treating the market as a prior
 * and DC as evidence, the posterior is the (normalized) product of the powered distributions.
 * Unlike a linear pool it is decisive — it actively suppresses a minority opinion rather than
 * averaging it in — which is exactly what we want to kill the no-opponent-strength absurdities.
 *
 * When no market odds exist for a fixture (knockout placeholders, un-scraped games) the caller
 * falls back to pure DC, so dc-market-v1 degrades gracefully to dixon-coles-v1.
 */

import { type Outcome, dcScoreMatrix, outcomeProbs } from './model.ts';

const EPS = 1e-6;

/** Normalize a 1X2 triple to sum to 1 (guards against zeros / vig residue). */
export function normalizeOutcome(o: Outcome): Outcome {
  const s = o.pHome + o.pDraw + o.pAway;
  if (!(s > 0)) return { pHome: 1 / 3, pDraw: 1 / 3, pAway: 1 / 3 };
  return { pHome: o.pHome / s, pDraw: o.pDraw / s, pAway: o.pAway / s };
}

/**
 * Logarithmic opinion pool of two 1X2 distributions. marketWeight w in [0,1]:
 * w=1 → pure market, w=0 → pure model. Each probability is floored at EPS before the
 * geometric mean so a literal 0 in either source cannot annihilate an outcome.
 */
export function logOpinionPool(dc: Outcome, market: Outcome, marketWeight: number): Outcome {
  const w = Math.min(1, Math.max(0, marketWeight));
  const blend = (m: number, d: number): number =>
    Math.exp(w * Math.log(Math.max(m, EPS)) + (1 - w) * Math.log(Math.max(d, EPS)));
  return normalizeOutcome({
    pHome: blend(market.pHome, dc.pHome),
    pDraw: blend(market.pDraw, dc.pDraw),
    pAway: blend(market.pAway, dc.pAway),
  });
}

/**
 * Find (λ, μ) whose Dixon-Coles scoreline matrix reproduces `target` 1X2 as closely as
 * possible, holding ρ fixed. Used to give the blended prediction coherent expected-goals
 * numbers (the prediction row stores both 1X2 and exp goals). Deterministic coordinate
 * descent with a shrinking step from `init` (the model's own λ/μ) — cheap (11×11 matrix).
 */
export function ratesForOutcome(
  target: Outcome,
  rho: number,
  init: { lambda: number; mu: number },
  opts: { iterations?: number; minRate?: number; maxRate?: number } = {},
): { lambda: number; mu: number } {
  const iterations = opts.iterations ?? 60;
  const lo = opts.minRate ?? 0.05;
  const hi = opts.maxRate ?? 6;
  const clamp = (v: number): number => Math.min(hi, Math.max(lo, v));
  const err = (l: number, m: number): number => {
    const o = outcomeProbs(dcScoreMatrix(l, m, rho));
    return (
      (o.pHome - target.pHome) ** 2 + (o.pDraw - target.pDraw) ** 2 + (o.pAway - target.pAway) ** 2
    );
  };

  let lambda = clamp(init.lambda);
  let mu = clamp(init.mu);
  let best = err(lambda, mu);
  let step = 0.5;
  for (let it = 0; it < iterations; it++) {
    let improved = false;
    for (const [dl, dm] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ] as const) {
      const nl = clamp(lambda + dl);
      const nm = clamp(mu + dm);
      const e = err(nl, nm);
      if (e < best - 1e-12) {
        best = e;
        lambda = nl;
        mu = nm;
        improved = true;
      }
    }
    if (!improved) step *= 0.5;
    if (step < 1e-4) break;
  }
  return { lambda, mu };
}
