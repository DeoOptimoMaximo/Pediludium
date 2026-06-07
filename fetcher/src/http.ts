import { z } from 'zod';
import { config } from './config.ts';
import { PoliteClient, RateLimitedError, pickUserAgent } from './politeness.ts';

/**
 * Thin HTTP layer over native fetch (Node >=22 / 24), routed through the polite queue.
 * NEVER call SofaScore outside this module — it's the single choke point (docs/04 golden rule).
 */

const client = new PoliteClient({
  delayMinMs: config.delayMinMs,
  delayMaxMs: config.delayMaxMs,
  maxRetries: config.maxRetries,
  backoffMinMs: config.backoffMinMs,
  backoffMaxMs: config.backoffMaxMs,
  circuitThreshold: config.circuitThreshold,
  circuitCooldownMs: config.circuitCooldownMs,
});

function baseHeaders(): Record<string, string> {
  return {
    'User-Agent': pickUserAgent(),
    Accept: 'application/json',
    Referer: 'https://www.sofascore.com/',
    Origin: 'https://www.sofascore.com',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export interface FetchResult<T> {
  data: T;
  raw: unknown;
  status: number;
  url: string;
  durationMs: number;
}

/**
 * GET a path under the configured base, validate with `schema`, return both parsed + raw.
 * Logs url/status/duration (docs/03 §4). Throws RateLimitedError on 403/429 so the
 * polite client can back off / trip the breaker.
 */
export async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<FetchResult<T>> {
  const url = `${config.baseUrl}${path}`;
  return client.run(async () => {
    const startedAt = Date.now();
    const res = await fetch(url, { headers: baseHeaders() });
    const durationMs = Date.now() - startedAt;

    if (res.status === 403 || res.status === 429) {
      console.warn(`[http] ${res.status} ${url} (${durationMs}ms) — blocked`);
      throw new RateLimitedError(res.status, parseRetryAfter(res.headers.get('retry-after')));
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[http] ${res.status} ${url}: ${body.slice(0, 200)}`);
    }

    const raw: unknown = await res.json();
    console.log(`[http] ${res.status} ${url} (${durationMs}ms)`);
    const data = schema.parse(raw);
    return { data, raw, status: res.status, url, durationMs };
  }, path);
}
