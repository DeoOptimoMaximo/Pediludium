import type { Browser, BrowserContext, Page, Response as PWResponse } from 'playwright-core';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { config } from './config.ts';
import { PoliteClient, RateLimitedError } from './politeness.ts';
import type { FetchResult } from './http.ts';

/**
 * Browser transport — drives the REAL installed Google Chrome (channel: 'chrome') via
 * Playwright. This is the working path: SofaScore's Varnish edge blocks non-browser TLS
 * fingerprints (undici/curl → 403), but real Chrome from this residential machine → 200
 * (proven 2026-06-07). Native fetch in http.ts stays for reference / other hosts.
 *
 * One shared Chrome + context + page = concurrency 1, routed through the polite queue.
 * Headful by default (matches what we proved); set SOFA_HEADLESS=1 for background runs.
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

let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;
let launching: Promise<Page> | undefined;

async function ensurePage(): Promise<Page> {
  if (page) return page;
  if (!launching) {
    launching = (async () => {
      browser = await chromium.launch({
        channel: 'chrome', // use the system Google Chrome, not bundled Chromium
        headless: process.env.SOFA_HEADLESS === '1',
      });
      // No UA override: let real Chrome send its genuine UA + client hints (most browser-like).
      context = await browser.newContext({ locale: 'en-US' });
      page = await context.newPage();
      return page;
    })();
  }
  return launching;
}

function parseRetryAfter(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** GET `path` under the configured base via real Chrome; validate + return parsed & raw. */
export async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<FetchResult<T>> {
  const url = `${config.baseUrl}${path}`;
  return client.run(async () => {
    const p = await ensurePage();
    const startedAt = Date.now();
    const resp: PWResponse | null = await p.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const durationMs = Date.now() - startedAt;
    const status = resp?.status() ?? 0;

    if (status === 403 || status === 429) {
      console.warn(`[browser] ${status} ${url} (${durationMs}ms) — blocked`);
      throw new RateLimitedError(status, parseRetryAfter(resp?.headers()['retry-after']));
    }
    if (!resp || !resp.ok()) {
      throw new Error(`[browser] ${status} ${url}`);
    }

    const raw: unknown = await resp.json();
    console.log(`[browser] ${status} ${url} (${durationMs}ms)`);
    const data = schema.parse(raw);
    return { data, raw, status, url, durationMs };
  }, path);
}

/** Tear down Chrome. Call once at the end of a run. */
export async function closeBrowser(): Promise<void> {
  if (browser) await browser.close();
  browser = undefined;
  context = undefined;
  page = undefined;
  launching = undefined;
}
