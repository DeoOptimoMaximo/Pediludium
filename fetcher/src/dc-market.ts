import { config, WORLD_CUP } from './config.ts';
import { closeDb, dbQuery, upsertPrediction } from './db.ts';
import { HOSTS, homeEdge, loadDcMatches, loadMarketOdds } from './dc-data.ts';
import { logOpinionPool, ratesForOutcome } from './market-blend.ts';
import { dcScoreMatrix, fitDixonColes, outcomeProbs, rates } from './model.ts';

/**
 * Market-anchored Dixon-Coles predictions (docs/08 #4) — model_version = dc-market-v1.
 *
 * Side-by-side upgrade over dixon-coles-v1: same time-decayed DC fit, but for every fixture
 * that has a de-vigged market 1X2 (public.match_odds, from `edge:sofascore`) we anchor the
 * model to the market via a logarithmic opinion pool (see market-blend.ts). The market weight
 * is DC_MARKET_WEIGHT (default 0.6). Fixtures without market odds fall back to pure DC, so this
 * model degrades gracefully to dixon-coles-v1. Computed entirely from our own DB — zero
 * SofaScore calls — so it is safe to re-run. Does NOT touch dixon-coles-v1 / baseline rows.
 */

const MODEL_VERSION = 'dc-market-v1';
const MARKET_WEIGHT = (() => {
  const raw = Number(process.env.DC_MARKET_WEIGHT);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.6;
})();
void config; // env-parsed for parity/side effects

async function main(): Promise<void> {
  const S = WORLD_CUP.seasonId2026;
  console.log(`\n=== Pediludium predictions (${MODEL_VERSION}, market weight ${MARKET_WEIGHT}) ===\n`);

  const now = Date.now();
  const matches = await loadDcMatches(now);
  console.log(`[dcm] fitting on ${matches.length} unique historical matches (time-decay weighted)`);
  const fit = fitDixonColes(matches, { halfLifeDays: 540, iterations: 250 });
  console.log(
    `[dcm] fitted ${fit.teams.length} teams · home γ=${fit.gamma.toFixed(3)} · ρ=${fit.rho.toFixed(3)}`,
  );

  const market = await loadMarketOdds();
  console.log(`[dcm] ${market.size} fixtures have market odds available for anchoring`);

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
  let blended = 0;
  for (const f of fixtures) {
    const matchId = Number(f.ss_id);
    const h = Number(f.home_team_id);
    const a = Number(f.away_team_id);
    const hostHome = HOSTS.has(f.home_alpha2 ?? '');
    const edge = homeEdge(fit, hostHome);
    const { lambda, mu } = rates(fit, h, a, edge - fit.gamma);
    const dc = outcomeProbs(dcScoreMatrix(lambda, mu, fit.rho));

    const mkt = market.get(matchId);
    let out = dc;
    let expHome = lambda;
    let expAway = mu;
    if (mkt) {
      out = logOpinionPool(dc, mkt, MARKET_WEIGHT);
      const r = ratesForOutcome(out, fit.rho, { lambda, mu });
      expHome = r.lambda;
      expAway = r.mu;
      blended++;
    }

    await upsertPrediction({
      match_id: matchId as unknown as number,
      model_version: MODEL_VERSION,
      p_home: out.pHome,
      p_draw: out.pDraw,
      p_away: out.pAway,
      exp_home_goals: expHome,
      exp_away_goals: expAway,
    });
    written++;
  }
  console.log(
    `\n=== Predictions written: ${written} fixtures (${blended} market-anchored, ${written - blended} pure DC fallback) — model ${MODEL_VERSION} ===\n`,
  );
}

main()
  .catch((err) => {
    console.error('[dcm] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
