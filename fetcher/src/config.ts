import { z } from 'zod';

/**
 * Runtime config, zod-parsed from env with sane defaults (docs/04: "config = .env + zod-parsed").
 * Nothing here is hardcoded at call sites — override via .env.
 */
const ConfigSchema = z.object({
  baseUrl: z.string().default('https://api.sofascore.com/api/v1'),
  delayMinMs: z.coerce.number().int().positive().default(1500),
  delayMaxMs: z.coerce.number().int().positive().default(4000),
  maxRetries: z.coerce.number().int().nonnegative().default(3),
  backoffMinMs: z.coerce.number().int().positive().default(2000),
  backoffMaxMs: z.coerce.number().int().positive().default(5000),
  circuitThreshold: z.coerce.number().int().positive().default(4),
  circuitCooldownMs: z.coerce.number().int().positive().default(15 * 60_000),
  sampleDir: z.string().default('.probe-samples'),
  dbUrl: z.string().default('postgresql://postgres:postgres@127.0.0.1:56322/postgres'),
  // egress source IP for browser fetches (e.g. iPhone tether 172.20.10.x → mobile IP).
  // Empty = use default route. Or set SOFA_VIA_IPHONE=1 to auto-detect the tether.
  sourceAddr: z.string().optional(),
  // direct upstream HTTP CONNECT proxy for browser egress (e.g. the mobile-phone-proxy on
  // the iPhone over Tailscale: http://100.71.146.11:8888 → Telemach cellular IP). Takes
  // precedence over sourceAddr/VIA_IPHONE — no local source-address proxy is started.
  proxyServer: z.string().optional(),

  // ── Edge layer (Web2↔Web3 odds, +EV/arb, dry-run trading) ──────────────────
  // Safety first: the trader simulates unless EDGE_DRY_RUN is explicitly 'false'.
  edgeDryRun: z
    .preprocess((v) => (v === undefined ? true : v !== 'false' && v !== '0'), z.boolean())
    .default(true),
  // Polymarket read endpoints (no auth needed for Gamma discovery / CLOB books).
  pmGammaHost: z.string().default('https://gamma-api.polymarket.com'),
  pmClobHost: z.string().default('https://clob.polymarket.com'),
  // Optional comma-separated Gamma tag slugs to seed WC market discovery (e.g.
  // 'soccer,fifa-world-cup'); empty = discover live via /tags + fixture name-match.
  pmTagSlugs: z.string().optional(),
  // Polymarket trading credentials (only needed when EDGE_DRY_RUN=false). v2 stack.
  pmPrivateKey: z.string().optional(),
  pmFunderAddress: z.string().optional(),
  pmSignatureType: z.coerce.number().int().default(1), // 0 EOA | 1 proxy | 2 safe | 3 1271
  polygonRpcUrl: z.string().optional(),
  // Sharp-consensus fallback (the-odds-api.com) — Pinnacle/Betfair WC odds for calibration.
  theOddsApiKey: z.string().optional(),
  // Engine thresholds + risk management.
  edgeMinEv: z.coerce.number().default(0.03), // flag +EV when model edge ≥ 3%
  edgeMinArb: z.coerce.number().default(0.005), // flag arb when guaranteed profit ≥ 0.5%
  // Longshot guards — the market is a sharp prior at long odds; a model "edge" on a
  // 40.0 outsider is almost always our model's tail miscalibration, not real value.
  edgeMinMarketProb: z.coerce.number().default(0.06), // distrust +EV below this no-vig prob
  edgeMaxEvOdds: z.coerce.number().default(6.0), // and above these decimal odds
  edgeKellyFraction: z.coerce.number().default(0.25), // fractional Kelly multiplier
  edgeMaxStakeUsd: z.coerce.number().default(25), // hard cap per single position
  edgeDailyLossLimitUsd: z.coerce.number().default(100), // halt trading past this daily loss
  edgePaperBankrollUsd: z.coerce.number().default(1000), // seed for the paper wallet
  edgeModelVersion: z.string().default('dixon-coles-v1'), // which prediction sources +EV
});

export type Config = z.infer<typeof ConfigSchema>;

export const config: Config = ConfigSchema.parse({
  baseUrl: process.env.SOFA_BASE_URL,
  delayMinMs: process.env.SOFA_DELAY_MIN_MS,
  delayMaxMs: process.env.SOFA_DELAY_MAX_MS,
  maxRetries: process.env.SOFA_MAX_RETRIES,
  backoffMinMs: process.env.SOFA_BACKOFF_MIN_MS,
  backoffMaxMs: process.env.SOFA_BACKOFF_MAX_MS,
  circuitThreshold: process.env.SOFA_CIRCUIT_THRESHOLD,
  circuitCooldownMs: process.env.SOFA_CIRCUIT_COOLDOWN_MS,
  sampleDir: process.env.SOFA_SAMPLE_DIR,
  dbUrl: process.env.SUPABASE_DB_URL,
  sourceAddr: process.env.SOFA_SOURCE_ADDR,
  proxyServer: process.env.SOFA_PROXY_SERVER,
  edgeDryRun: process.env.EDGE_DRY_RUN,
  pmGammaHost: process.env.PM_GAMMA_HOST,
  pmClobHost: process.env.PM_CLOB_HOST,
  pmTagSlugs: process.env.PM_TAG_SLUGS,
  pmPrivateKey: process.env.PM_PRIVATE_KEY,
  pmFunderAddress: process.env.PM_FUNDER_ADDRESS,
  pmSignatureType: process.env.PM_SIGNATURE_TYPE,
  polygonRpcUrl: process.env.POLYGON_RPC_URL,
  theOddsApiKey: process.env.THE_ODDS_API_KEY,
  edgeMinEv: process.env.EDGE_MIN_EV,
  edgeMinArb: process.env.EDGE_MIN_ARB,
  edgeMinMarketProb: process.env.EDGE_MIN_MARKET_PROB,
  edgeMaxEvOdds: process.env.EDGE_MAX_EV_ODDS,
  edgeKellyFraction: process.env.EDGE_KELLY_FRACTION,
  edgeMaxStakeUsd: process.env.EDGE_MAX_STAKE_USD,
  edgeDailyLossLimitUsd: process.env.EDGE_DAILY_LOSS_LIMIT_USD,
  edgePaperBankrollUsd: process.env.EDGE_PAPER_BANKROLL_USD,
  edgeModelVersion: process.env.EDGE_MODEL_VERSION,
});

/**
 * World Cup identifiers (docs/02).
 * seasonId2026 RESOLVED LIVE on 2026-06-07 via /unique-tournament/16/seasons → 58210
 * ("World Cup 2026"). NOTE: season id 16 is World Cup *2006* — do not confuse with the
 * unique-tournament id 16. The probe still re-resolves at runtime as the source of truth.
 */
export const WORLD_CUP = {
  uniqueTournamentId: 16,
  categoryId: 1468,
  slug: 'world-championship',
  seasonId2026: 58210,
} as const;
