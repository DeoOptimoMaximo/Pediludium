/**
 * Dixon-Coles goals model + Monte-Carlo tournament helpers — pure math, no IO.
 *
 * Dixon & Coles (1997): independent Poisson under-fits low scores and ignores the
 * negative dependence between the two teams' goals. They add:
 *   - a low-score correction τ (couples the 0-0 / 1-0 / 0-1 / 1-1 cells), and
 *   - exponential time-decay weighting so recent matches dominate the fit.
 *
 * For each match: λ = exp(attack[home] − defense[away] + γ),  μ = exp(attack[away] − defense[home])
 * where γ is the (log) home advantage. We fit attack/defense per team, γ and ρ by
 * weighted maximum likelihood via gradient ascent (analytic gradients).
 *
 * Everything here is deterministic given its inputs (caller supplies the RNG), so it is
 * unit-testable and reused by both the predictor (dixon-coles.ts) and the simulator
 * (simulate.ts). No database, no network — see docs/08 and docs/13.
 */

export interface DcMatch {
  home: number; // team id
  away: number; // team id
  hs: number; // home goals
  as: number; // away goals
  ageDays: number; // age of the match in days (for time decay), >= 0
}

export interface DcFit {
  attack: Map<number, number>;
  defense: Map<number, number>;
  gamma: number; // log home advantage
  rho: number; // Dixon-Coles low-score correction
  teams: number[];
}

// ── Dixon-Coles low-score correction ───────────────────────────────────────
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
export function dcScoreMatrix(lambda: number, mu: number, rho: number, MAX = 10): number[][] {
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
    const phi = ph[i]!;
    for (let j = 0; j <= MAX; j++) {
      const p = phi * pa[j]! * tau(i, j, lambda, mu, rho);
      const v = p > 0 ? p : 0; // τ can dip slightly negative for extreme ρ; clamp
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

/** λ, μ for a fixture from fitted strengths. extraHome is an additive log home edge. */
export function rates(
  fit: DcFit,
  home: number,
  away: number,
  extraHome = 0,
): { lambda: number; mu: number } {
  const ah = fit.attack.get(home) ?? 0;
  const aa = fit.attack.get(away) ?? 0;
  const dh = fit.defense.get(home) ?? 0;
  const da = fit.defense.get(away) ?? 0;
  const lambda = Math.exp(ah - da + fit.gamma + extraHome);
  const mu = Math.exp(aa - dh);
  return { lambda, mu };
}

// ── Fitting (weighted MLE via gradient ascent) ──────────────────────────────
export interface FitOptions {
  halfLifeDays?: number; // time-decay half-life (default 540 ≈ 18 months)
  iterations?: number; // gradient ascent steps (default 250)
  learningRate?: number; // step size (default 0.06)
  maxRate?: number; // clamp λ,μ to avoid blow-ups (default 8 goals)
}

/** Fit attack/defense/γ/ρ by weighted maximum likelihood. Deterministic. */
export function fitDixonColes(matches: DcMatch[], opts: FitOptions = {}): DcFit {
  const halfLife = opts.halfLifeDays ?? 540;
  const iterations = opts.iterations ?? 250;
  const lr = opts.learningRate ?? 0.06;
  const decay = Math.log(2) / halfLife;

  const teamSet = new Set<number>();
  for (const m of matches) {
    teamSet.add(m.home);
    teamSet.add(m.away);
  }
  const teams = [...teamSet];
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;

  const attack = new Float64Array(n); // start at 0 (league average)
  const defense = new Float64Array(n);
  let gamma = 0.25; // ~ exp(0.25)=1.28 typical home edge
  let rho = -0.05; // small negative is typical for football

  // precompute per-match weight and team indices
  const W = new Float64Array(matches.length);
  const HI = new Int32Array(matches.length);
  const AI = new Int32Array(matches.length);
  let wsum = 0;
  const HS = new Int32Array(matches.length);
  const AS = new Int32Array(matches.length);
  for (let k = 0; k < matches.length; k++) {
    const m = matches[k]!;
    const w = Math.exp(-decay * Math.max(0, m.ageDays));
    W[k] = w;
    wsum += w;
    HI[k] = idx.get(m.home)!;
    AI[k] = idx.get(m.away)!;
    HS[k] = m.hs;
    AS[k] = m.as;
  }
  const norm = wsum > 0 ? 1 / wsum : 1;
  const cap = opts.maxRate ?? 8;

  for (let it = 0; it < iterations; it++) {
    const gAtt = new Float64Array(n);
    const gDef = new Float64Array(n);
    let gGamma = 0;
    let gRho = 0;

    for (let k = 0; k < matches.length; k++) {
      const w = W[k]!;
      const hi = HI[k]!;
      const ai = AI[k]!;
      const attH = attack[hi]!;
      const attA = attack[ai]!;
      const defH = defense[hi]!;
      const defA = defense[ai]!;
      let lambda = Math.exp(attH - defA + gamma);
      let mu = Math.exp(attA - defH);
      if (lambda > cap) lambda = cap;
      if (mu > cap) mu = cap;
      const x = HS[k]!;
      const y = AS[k]!;

      // Poisson part: ∂(x lnλ − λ)/∂a_home = x − λ, etc.
      let gradAttH = w * (x - lambda); // dLamb
      let gradAttA = w * (y - mu); // dMu
      let gradDefH = -gradAttA;
      let gradDefA = -gradAttH;
      gGamma += gradAttH;

      // Dixon-Coles τ part (only low scores contribute a correction)
      if (x <= 1 && y <= 1) {
        const t = tau(x, y, lambda, mu, rho);
        if (t > 1e-9) {
          // ∂τ/∂λ, ∂τ/∂μ, ∂τ/∂ρ
          let dT_dLam = 0;
          let dT_dMu = 0;
          let dT_dRho = 0;
          if (x === 0 && y === 0) {
            dT_dLam = -mu * rho;
            dT_dMu = -lambda * rho;
            dT_dRho = -lambda * mu;
          } else if (x === 0 && y === 1) {
            dT_dLam = rho;
            dT_dRho = lambda;
          } else if (x === 1 && y === 0) {
            dT_dMu = rho;
            dT_dRho = mu;
          } else if (x === 1 && y === 1) {
            dT_dRho = -1;
          }
          const inv = w / t;
          // chain through log-rates: ∂lnτ/∂a_home = (∂τ/∂λ)·λ / τ
          const cLam = inv * dT_dLam * lambda;
          const cMu = inv * dT_dMu * mu;
          gradAttH += cLam;
          gradDefA += -cLam;
          gGamma += cLam;
          gradAttA += cMu;
          gradDefH += -cMu;
          gRho += inv * dT_dRho;
        }
      }
      gAtt[hi] = gAtt[hi]! + gradAttH;
      gAtt[ai] = gAtt[ai]! + gradAttA;
      gDef[hi] = gDef[hi]! + gradDefH;
      gDef[ai] = gDef[ai]! + gradDefA;
    }

    // gradient ascent step (normalized by total weight → lr is data-size independent)
    for (let i = 0; i < n; i++) {
      attack[i] = attack[i]! + lr * gAtt[i]! * norm;
      defense[i] = defense[i]! + lr * gDef[i]! * norm;
    }
    gamma += lr * gGamma * norm;
    rho += lr * gRho * norm;
    // keep ρ in a safe range (τ must stay positive for plausible λ,μ)
    if (rho > 0.2) rho = 0.2;
    if (rho < -0.2) rho = -0.2;

    // identifiability: attack confounded with defense by a constant → fix mean attack = 0
    let mean = 0;
    for (let i = 0; i < n; i++) mean += attack[i]!;
    mean /= n;
    for (let i = 0; i < n; i++) attack[i] = attack[i]! - mean;
  }

  const attackMap = new Map<number, number>();
  const defenseMap = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    attackMap.set(teams[i]!, attack[i]!);
    defenseMap.set(teams[i]!, defense[i]!);
  }
  return { attack: attackMap, defense: defenseMap, gamma, rho, teams };
}

// ── Sampling (for Monte-Carlo) ──────────────────────────────────────────────
/** Cumulative-sum a normalized matrix into a flat CDF for O(log n) sampling. */
export function buildCdf(matrix: number[][]): { cdf: Float64Array; cols: number } {
  const rows = matrix.length;
  const cols = matrix[0]!.length;
  const cdf = new Float64Array(rows * cols);
  let acc = 0;
  for (let i = 0; i < rows; i++) {
    const row = matrix[i]!;
    for (let j = 0; j < cols; j++) {
      acc += row[j]!;
      cdf[i * cols + j] = acc;
    }
  }
  return { cdf, cols };
}

/** Draw a scoreline [home, away] from a CDF. rng() must return [0,1). */
export function sampleScore(
  cdfObj: { cdf: Float64Array; cols: number },
  rng: () => number,
): [number, number] {
  const { cdf, cols } = cdfObj;
  const r = rng() * cdf[cdf.length - 1]!;
  // binary search the cumulative distribution
  let lo = 0;
  let hi = cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid]! < r) lo = mid + 1;
    else hi = mid;
  }
  return [Math.floor(lo / cols), lo % cols];
}

// ── Mulberry32: tiny seeded PRNG (deterministic, reproducible simulations) ──
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
