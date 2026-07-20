/**
 * Final reckoning for a completed competition (docs/21 §3A).
 *
 * `/accuracy` has always shown the running per-match scorecard. Once a tournament is
 * over, the interesting questions change: did the model beat a coin flip, did it beat
 * the bookmaker, was it worse in the knockout than in the groups, and are its stated
 * probabilities *calibrated* — when it says 30%, does that happen 30% of the time?
 *
 * This module is pure: it takes already-scored calibration rows (export-snapshot.ts)
 * and returns the aggregate. No DB, no clock, no I/O — so it is testable, and the web
 * only has to render.
 *
 * Honesty rules baked in here, because a report that flatters itself is worthless:
 *   - every aggregate carries its own `n`; models scored on different subsets are
 *     never silently compared (that's what `common` is for),
 *   - the market gets scored on exactly the same frozen-before-kickoff basis,
 *   - coverage gaps are reported as data, not omitted.
 */

/** One scored prediction — the row shape export-snapshot.ts writes into `calib`. */
export interface ScoredRow {
  match_id: number;
  kickoff: string;
  phase?: 'group' | 'ko';
  p: number[]; // [home, draw, away]
  outcome: number; // index into p
  brier: number;
  logloss: number;
}

export interface Aggregate {
  n: number;
  brier: number;
  logloss: number;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  /** mean forecast probability of the legs that fell in this bin */
  predicted: number;
  /** fraction of those legs that actually happened */
  observed: number;
}

export interface Surprise {
  match_id: number;
  kickoff: string;
  outcome: number;
  /** probability the model gave to what actually happened */
  p_actual: number;
}

export interface ModelReport {
  version: string;
  overall: Aggregate;
  group: Aggregate | null;
  ko: Aggregate | null;
  /** 1 − brier/naive: 0 = no better than a uniform guess, 1 = perfect, <0 = worse than guessing */
  skill: number;
  reliability: ReliabilityBin[];
  surprises: Surprise[];
}

export interface Subset {
  n: number;
  brier: Record<string, number>;
  logloss: Record<string, number>;
}

export interface FinalReport {
  /** matches with at least one model scored — the denominator for coverage */
  matches: number;
  naive: Aggregate;
  models: ModelReport[];
  /** like-for-like across our own models, re-scored on only the matches all of them predicted */
  common: Subset | null;
  /** the same treatment including the bookmaker — a far smaller set, kept separate so the
   *  model-vs-model comparison is not dragged down to the market's thin coverage */
  vsMarket: Subset | null;
}

/** Multiclass Brier / log-loss of the uniform ⅓-⅓-⅓ guess — the bar for "knows anything". */
export const NAIVE_BRIER = 3 * (1 / 3) ** 2 - 2 * (1 / 3) + 1; // = 2/3
export const NAIVE_LOGLOSS = Math.log(3); // = 1.0986

const round4 = (v: number) => Math.round(v * 10000) / 10000;

function aggregate(rows: ScoredRow[]): Aggregate {
  const n = rows.length;
  if (n === 0) return { n: 0, brier: 0, logloss: 0 };
  return {
    n,
    brier: round4(rows.reduce((s, r) => s + r.brier, 0) / n),
    logloss: round4(rows.reduce((s, r) => s + r.logloss, 0) / n),
  };
}

/**
 * Reliability over the pooled one-vs-rest legs: each match contributes three
 * (forecast probability, did-it-happen) pairs. Pooling is what makes the diagram
 * readable at 104 matches — splitting per outcome would leave ~4 draws per bin.
 *
 * Empty bins are dropped rather than plotted at observed=0, which would draw a
 * confident-looking point backed by no data.
 */
export function reliability(rows: ScoredRow[], bins = 5): ReliabilityBin[] {
  const buckets: { p: number[]; hit: number[] }[] = Array.from({ length: bins }, () => ({ p: [], hit: [] }));
  for (const r of rows) {
    r.p.forEach((pi, i) => {
      // clamp keeps p === 1 inside the top bin instead of overflowing the array
      const b = Math.min(bins - 1, Math.floor(pi * bins));
      buckets[b]!.p.push(pi);
      buckets[b]!.hit.push(i === r.outcome ? 1 : 0);
    });
  }
  return buckets
    .map((b, i) => ({
      lo: round4(i / bins),
      hi: round4((i + 1) / bins),
      n: b.p.length,
      predicted: b.p.length ? round4(b.p.reduce((s, v) => s + v, 0) / b.p.length) : 0,
      observed: b.hit.length ? round4(b.hit.reduce((s, v) => s + v, 0) / b.hit.length) : 0,
    }))
    .filter((b) => b.n > 0);
}

/** The N results the model saw coming least — lowest probability assigned to what happened. */
export function surprises(rows: ScoredRow[], topN = 5): Surprise[] {
  return rows
    .map((r) => ({
      match_id: r.match_id,
      kickoff: r.kickoff,
      outcome: r.outcome,
      p_actual: round4(r.p[r.outcome] ?? 0),
    }))
    .sort((a, b) => a.p_actual - b.p_actual || a.kickoff.localeCompare(b.kickoff))
    .slice(0, topN);
}

export function modelReport(version: string, rows: ScoredRow[], topN = 5): ModelReport {
  const overall = aggregate(rows);
  const group = rows.filter((r) => r.phase === 'group');
  const ko = rows.filter((r) => r.phase === 'ko');
  return {
    version,
    overall,
    group: group.length ? aggregate(group) : null,
    ko: ko.length ? aggregate(ko) : null,
    skill: overall.n ? round4(1 - overall.brier / NAIVE_BRIER) : 0,
    reliability: reliability(rows),
    surprises: surprises(rows, topN),
  };
}

/**
 * Re-score every model on the intersection of the matches they all predicted.
 *
 * Without this the headline table lies by omission: dc-market-v1 only exists from the
 * moment it was introduced mid-tournament, and the market rows cover a dozen group
 * matches. Comparing 104-match Brier against 12-match Brier is not a comparison.
 * Returns null when the intersection is too small to say anything.
 */
export function commonSubset(byModel: Record<string, ScoredRow[]>, minN = 5): Subset | null {
  const versions = Object.keys(byModel);
  if (versions.length < 2) return null;

  let shared = new Set<number>(byModel[versions[0]!]!.map((r) => r.match_id));
  for (const v of versions.slice(1)) {
    const ids = new Set(byModel[v]!.map((r) => r.match_id));
    shared = new Set([...shared].filter((id) => ids.has(id)));
  }
  if (shared.size < minN) return null;

  const brier: Record<string, number> = {};
  const logloss: Record<string, number> = {};
  for (const v of versions) {
    const agg = aggregate(byModel[v]!.filter((r) => shared.has(r.match_id)));
    brier[v] = agg.brier;
    logloss[v] = agg.logloss;
  }
  return { n: shared.size, brier, logloss };
}

export function buildFinalReport(
  byModel: Record<string, ScoredRow[]>,
  topN = 5,
  /** excluded from `common` so its thin coverage cannot shrink the model-vs-model set */
  marketVersion = 'market-implied',
): FinalReport {
  const matches = new Set<number>();
  for (const rows of Object.values(byModel)) for (const r of rows) matches.add(r.match_id);

  const ours = Object.fromEntries(Object.entries(byModel).filter(([v]) => v !== marketVersion));

  return {
    matches: matches.size,
    naive: { n: matches.size, brier: round4(NAIVE_BRIER), logloss: round4(NAIVE_LOGLOSS) },
    // best (lowest) Brier first — the ranking IS the headline
    models: Object.entries(byModel)
      .map(([v, rows]) => modelReport(v, rows, topN))
      .sort((a, b) => a.overall.brier - b.overall.brier),
    common: commonSubset(ours),
    vsMarket: byModel[marketVersion]?.length ? commonSubset(byModel) : null,
  };
}
