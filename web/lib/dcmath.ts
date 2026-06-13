/**
 * Dixon-Coles scoreline math — a tiny, dependency-free mirror of the relevant pieces of
 * `fetcher/src/model.ts`, used purely to VISUALIZE the model on the blog (the score-matrix
 * heatmap and the worked outcome split). It does not fit or predict anything — it just
 * recomputes P(i,j) from given λ, μ, ρ so the diagram is the real model, not a mock-up.
 *
 * Kept in sync with model.ts: tau(), poissonPmf(), dcScoreMatrix(), outcomeProbs().
 */

/** τ couples only the four lowest scorelines; everything else is 1 (pure Poisson). */
export function tau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

export function poissonPmf(k: number, lambda: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
}

/** Normalized Dixon-Coles scoreline matrix m[i][j] = P(home i, away j), i,j in 0..MAX. */
export function dcScoreMatrix(lambda: number, mu: number, rho: number, MAX = 8): number[][] {
  const ph: number[] = [];
  const pa: number[] = [];
  for (let i = 0; i <= MAX; i++) {
    ph.push(poissonPmf(i, lambda));
    pa.push(poissonPmf(i, mu));
  }
  const m: number[][] = [];
  let sum = 0;
  for (let i = 0; i <= MAX; i++) {
    const row: number[] = [];
    for (let j = 0; j <= MAX; j++) {
      const p = ph[i]! * pa[j]! * tau(i, j, lambda, mu, rho);
      const v = p > 0 ? p : 0;
      row.push(v);
      sum += v;
    }
    m.push(row);
  }
  if (sum > 0) for (const row of m) for (let j = 0; j < row.length; j++) row[j] = row[j]! / sum;
  return m;
}

export interface Outcome {
  pHome: number;
  pDraw: number;
  pAway: number;
}

/** Sum the matrix into 1 / X / 2 by region: home = below diagonal, draw = diagonal, away = above. */
export function outcomeProbs(matrix: number[][]): Outcome {
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i]!;
    for (let j = 0; j < row.length; j++) {
      const p = row[j]!;
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
    }
  }
  const s = pHome + pDraw + pAway || 1;
  return { pHome: pHome / s, pDraw: pDraw / s, pAway: pAway / s };
}

/** Region a cell belongs to, for colouring the heatmap. */
export type Region = 'home' | 'draw' | 'away';
export const cellRegion = (i: number, j: number): Region => (i > j ? 'home' : i === j ? 'draw' : 'away');
