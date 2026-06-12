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
