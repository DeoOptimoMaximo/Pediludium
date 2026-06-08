import { config, WORLD_CUP } from './config.ts';
import { closeDb, dbQuery, upsertPrediction, upsertTeamRating } from './db.ts';
import { HOSTS, homeEdge, loadDcMatches } from './dc-data.ts';
import { dcScoreMatrix, fitDixonColes, outcomeProbs, rates } from './model.ts';

/**
 * Dixon-Coles match predictions (docs/08 #1, docs/13) — model_version = dixon-coles-v1.
 *
 * A real upgrade over the independent-Poisson baseline: low-score correlation correction
 * + exponential time-decay weighting, fitted by weighted MLE. Computed ENTIRELY from our
 * own stored history (public.team_match) — zero SofaScore calls, so it is safe to re-run.
 * Runs side-by-side with baseline-poisson-elo-v1 (the schema versions predictions).
 */

const MODEL_VERSION = 'dixon-coles-v1';
void config; // config is imported for parity/side effects (env-parsed) even if unused here

async function main(): Promise<void> {
  const S = WORLD_CUP.seasonId2026;
  console.log(`\n=== Pediludium predictions (${MODEL_VERSION}) ===\n`);

  const now = Date.now();
  const matches = await loadDcMatches(now);
  console.log(`[dc] fitting on ${matches.length} unique historical matches (time-decay weighted)`);
  const fit = fitDixonColes(matches, { halfLifeDays: 540, iterations: 250 });
  console.log(
    `[dc] fitted ${fit.teams.length} teams · home γ=${fit.gamma.toFixed(3)} (×${Math.exp(fit.gamma).toFixed(2)}) · ρ=${fit.rho.toFixed(3)}`,
  );

  // persist a Dixon-Coles power rating (attack+defense, scaled) alongside Elo for the UI
  const asOf = new Date(now).toISOString();
  const ratingTeams = await dbQuery<{ ss_id: string }>(
    'select ss_id from public.team where is_national',
  );
  for (const t of ratingTeams) {
    const id = Number(t.ss_id);
    const strength = (fit.attack.get(id) ?? 0) + (fit.defense.get(id) ?? 0);
    await upsertTeamRating(id, 'dc', Math.round(1500 + strength * 220), asOf);
  }

  // predict every not-yet-played WC group fixture (real teams; knockout has placeholders)
  const fixtures = await dbQuery<{
    ss_id: string;
    home_team_id: string;
    away_team_id: string;
    home_alpha2: string | null;
  }>(
    `select m.ss_id, m.home_team_id, m.away_team_id, ht.country_alpha2 as home_alpha2
       from public.match m join public.team ht on ht.ss_id = m.home_team_id
      where m.season_id = $1 and m.status_type = 'notstarted'
        and m.home_team_id is not null and m.away_team_id is not null`,
    [S],
  );

  let written = 0;
  for (const f of fixtures) {
    const h = Number(f.home_team_id);
    const a = Number(f.away_team_id);
    const hostHome = HOSTS.has(f.home_alpha2 ?? '');
    const edge = homeEdge(fit, hostHome);
    const { lambda, mu } = rates(fit, h, a, edge - fit.gamma);
    const { pHome, pDraw, pAway } = outcomeProbs(dcScoreMatrix(lambda, mu, fit.rho));
    await upsertPrediction({
      match_id: f.ss_id as unknown as number,
      model_version: MODEL_VERSION,
      p_home: pHome,
      p_draw: pDraw,
      p_away: pAway,
      exp_home_goals: lambda,
      exp_away_goals: mu,
    });
    written++;
  }
  console.log(`\n=== Predictions written: ${written} fixtures (model ${MODEL_VERSION}) ===\n`);
}

main()
  .catch((err) => {
    console.error('[dc] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
