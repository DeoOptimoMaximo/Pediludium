import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, WORLD_CUP } from './config.ts';
import { closeBrowser, getJson } from './browser.ts';
import { EventsResponseSchema } from './schemas.ts';
import { closeDb, dbQuery, upsertPrediction, upsertTeamRating } from './db.ts';

/**
 * Baseline predictions (docs/04 §D) — intentionally simple, transparent, and honest:
 *   1. Elo ratings fitted from each WC team's recent match history (power ranking).
 *   2. Independent Poisson goals model (attack/defense rates vs league average)
 *      → scoreline matrix → p_home / p_draw / p_away + expected goals.
 *
 * This is the MVP "primitive analytics". Advanced modelling is marked TODO/TBD below
 * and in docs/08-prediction-roadmap.md — the schema (prediction.model_version) already
 * supports running better models side-by-side.
 *
 * TODO(advanced) — what to use for serious prediction (see docs/08):
 *   - Dixon-Coles: low-score correlation correction + exponential time-decay weighting.
 *   - Opponent-strength & confederation adjustment (qualifiers vs friendlies differ wildly).
 *   - xG-based λ instead of realised goals (less noisy); pull /event/{id}/statistics.
 *   - Bivariate Poisson / Weibull-count or Bayesian hierarchical (PyMC/Stan) team strengths.
 *   - Blend with market odds (/event/{id}/odds) as a strong prior.
 *   - Monte-Carlo tournament simulation → group-advance & win-cup probabilities.
 *   - Gradient boosting on engineered features (form, rest days, travel, squad value).
 */

const MODEL_VERSION = 'baseline-poisson-elo-v1';
const HOSTS = new Set(['US', 'MX', 'CA']); // host nations get a real home edge

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

const sample = async (name: string, payload: unknown) => {
  await mkdir(join(config.sampleDir, 'history'), { recursive: true });
  await writeFile(
    join(config.sampleDir, 'history', `${name}.json`),
    JSON.stringify(payload, null, 2),
    'utf8',
  );
};

// ── math ────────────────────────────────────────────────────────────────
function poissonPmf(k: number, lambda: number): number {
  let f = 1;
  for (let i = 2; i <= k; i++) f *= i;
  return (Math.exp(-lambda) * lambda ** k) / f;
}

/** Outcome probabilities + expected goals from two independent Poisson rates. */
function poissonOutcome(lh: number, la: number): {
  pHome: number;
  pDraw: number;
  pAway: number;
} {
  const MAX = 10;
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  for (let i = 0; i <= MAX; i++) {
    for (let j = 0; j <= MAX; j++) {
      const p = poissonPmf(i, lh) * poissonPmf(j, la);
      if (i > j) pHome += p;
      else if (i === j) pDraw += p;
      else pAway += p;
    }
  }
  const s = pHome + pDraw + pAway || 1;
  return { pHome: pHome / s, pDraw: pDraw / s, pAway: pAway / s };
}

// ── main ──────────────────────────────────────────────────────────────────
interface Acc {
  gf: number;
  ga: number;
  n: number;
}

async function main(): Promise<void> {
  const T = WORLD_CUP.uniqueTournamentId;
  const S = WORLD_CUP.seasonId2026;
  console.log(`\n=== Pediludium predictions (${MODEL_VERSION}) ===\n`);

  const teams = await dbQuery<{ ss_id: string; name: string; country_alpha2: string | null }>(
    'select ss_id, name, country_alpha2 from public.team where is_national order by name',
  );
  console.log(`[predict] fitting from ${teams.length} national teams' histories...`);

  // 1) gather unique historical finished matches from the stored team_match table.
  // We deliberately read Postgres here instead of hitting SofaScore live: the direct API
  // is challenge-blocked, and the old per-team live fetch silently failed for every team,
  // leaving the whole Elo table stuck at the 1500 default. team_match is populated by the
  // history backfill through the working transport, so the data is already local.
  // Each match is stored once per side; distinct-on(event_id) collapses it to one row,
  // oriented home-first (is_home desc) so home/away and scores line up.
  const histRows = await dbQuery<{
    event_id: number;
    home_id: number;
    away_id: number;
    hs: number;
    ascore: number;
    ts: string | null;
  }>(
    `select distinct on (event_id)
            event_id,
            case when is_home then team_id else opponent_id end as home_id,
            case when is_home then opponent_id else team_id end as away_id,
            case when is_home then team_score else opponent_score end as hs,
            case when is_home then opponent_score else team_score end as ascore,
            start_ts as ts
       from public.team_match
      where team_score is not null and opponent_score is not null
        and opponent_id is not null
      order by event_id, is_home desc`,
  );
  // Postgres returns bigint columns (team ids) as strings — coerce to Number so the Elo
  // map keys match the numeric team ids used when persisting (getElo(Number(ss_id))).
  const hist = histRows
    .map((r) => ({
      id: Number(r.event_id),
      startTimestamp: r.ts ? Math.floor(Date.parse(r.ts) / 1000) : 0,
      homeTeam: { id: Number(r.home_id) },
      awayTeam: { id: Number(r.away_id) },
      homeScore: { current: Number(r.hs) },
      awayScore: { current: Number(r.ascore) },
    }))
    .sort((a, b) => a.startTimestamp - b.startTimestamp);
  console.log(`[predict] ${hist.length} unique historical matches (from team_match)`);

  // 2) Elo + goal accumulators (chronological)
  const elo = new Map<number, number>();
  const goals = new Map<number, Acc>();
  const getElo = (id: number) => elo.get(id) ?? 1500;
  const getAcc = (id: number) => goals.get(id) ?? { gf: 0, ga: 0, n: 0 };
  let totalGoals = 0;
  let teamMatches = 0;

  for (const e of hist) {
    const h = e.homeTeam?.id;
    const a = e.awayTeam?.id;
    const hs = e.homeScore?.current ?? 0;
    const as = e.awayScore?.current ?? 0;
    if (h == null || a == null) continue;

    // Elo update (modest home-field during fitting)
    const rh = getElo(h);
    const ra = getElo(a);
    const expH = 1 / (1 + 10 ** ((ra - rh - 60) / 400));
    const actH = hs > as ? 1 : hs === as ? 0.5 : 0;
    const k = 30 * Math.log(Math.abs(hs - as) + 1 + 1); // goal-diff weighted
    elo.set(h, rh + k * (actH - expH));
    elo.set(a, ra + k * (1 - actH - (1 - expH)));

    // goals
    const ah = getAcc(h);
    const aa = getAcc(a);
    goals.set(h, { gf: ah.gf + hs, ga: ah.ga + as, n: ah.n + 1 });
    goals.set(a, { gf: aa.gf + as, ga: aa.ga + hs, n: aa.n + 1 });
    totalGoals += hs + as;
    teamMatches += 2;
  }
  const leagueAvg = teamMatches ? totalGoals / teamMatches : 1.35;
  console.log(`[predict] league avg goals/team/match = ${leagueAvg.toFixed(3)}`);

  // persist Elo ratings (power ranking for the UI)
  const asOf = new Date(hist.at(-1)?.startTimestamp != null ? Date.now() : Date.now()).toISOString();
  for (const t of teams) {
    const id = Number(t.ss_id);
    await upsertTeamRating(id, 'elo', Math.round(getElo(id)), asOf);
  }

  // 3) predict every not-yet-played WC fixture
  const fixtures = await dbQuery<{
    ss_id: string;
    home_team_id: string;
    away_team_id: string;
    home_alpha2: string | null;
  }>(
    `select m.ss_id, m.home_team_id, m.away_team_id, ht.country_alpha2 as home_alpha2
       from public.match m join public.team ht on ht.ss_id=m.home_team_id
      where m.season_id=$1 and m.status_type='notstarted'
        and m.home_team_id is not null and m.away_team_id is not null`,
    [S],
  );

  const attack = (id: number) => {
    const acc = getAcc(id);
    return acc.n ? acc.gf / acc.n : leagueAvg;
  };
  const defense = (id: number) => {
    const acc = getAcc(id);
    return acc.n ? acc.ga / acc.n : leagueAvg;
  };

  let written = 0;
  for (const f of fixtures) {
    const h = Number(f.home_team_id);
    const a = Number(f.away_team_id);
    const homeAdv = HOSTS.has(f.home_alpha2 ?? '') ? 1.18 : 1.06; // host vs neutral-home
    const awayAdj = 0.96;
    // independent Poisson with opponent-strength baked in via defense rates
    const lh = Math.max(0.15, (attack(h) / leagueAvg) * (defense(a) / leagueAvg) * leagueAvg * homeAdv);
    const la = Math.max(0.15, (attack(a) / leagueAvg) * (defense(h) / leagueAvg) * leagueAvg * awayAdj);
    const { pHome, pDraw, pAway } = poissonOutcome(lh, la);
    await upsertPrediction({
      match_id: f.ss_id as unknown as number, // pg accepts string for bigint param
      model_version: MODEL_VERSION,
      p_home: pHome,
      p_draw: pDraw,
      p_away: pAway,
      exp_home_goals: lh,
      exp_away_goals: la,
    });
    written++;
  }
  console.log(`\n=== Predictions written: ${written} fixtures (model ${MODEL_VERSION}) ===\n`);
}

main()
  .catch((err) => {
    console.error('[predict] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await closeDb();
  });
