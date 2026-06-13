import type { Browser, BrowserContext, Page, Response as PWResponse } from 'playwright-core';
import { chromium } from 'playwright-core';
import { z } from 'zod';
import { config } from './config.ts';
import { PoliteClient, RateLimitedError, sleep } from './politeness.ts';
import { detectIphoneSource, startSourceProxy, type SourceProxy } from './source-proxy.ts';
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
let sourceProxy: SourceProxy | undefined;

/** Resolve Chrome's egress proxy: a direct upstream proxy (SOFA_PROXY_SERVER, e.g. the
 * mobile-phone-proxy over Tailscale) wins; else a local source-address proxy bound to
 * SOFA_SOURCE_ADDR / the SOFA_VIA_IPHONE tether. Undefined = the Mac's default route. */
async function resolveProxyServer(): Promise<string | undefined> {
  if (config.proxyServer) {
    console.log(`[browser] egress via upstream proxy ${config.proxyServer}`);
    return config.proxyServer;
  }
  const explicit = config.sourceAddr;
  const viaIphone = process.env.SOFA_VIA_IPHONE === '1';
  const src = explicit ?? (viaIphone ? detectIphoneSource() : undefined);
  if (!src) {
    if (viaIphone) console.warn('[browser] SOFA_VIA_IPHONE set but no 172.20.10.x tether found');
    return undefined;
  }
  sourceProxy = await startSourceProxy(src);
  console.log(`[browser] egress bound to ${src} via proxy 127.0.0.1:${sourceProxy.port}`);
  return `http://127.0.0.1:${sourceProxy.port}`;
}

async function ensurePage(): Promise<Page> {
  if (page) return page;
  if (!launching) {
    launching = (async () => {
      const proxyServer = await resolveProxyServer();
      browser = await chromium.launch({
        channel: 'chrome', // use the system Google Chrome, not bundled Chromium
        headless: process.env.SOFA_HEADLESS === '1',
        ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
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

/* ── piggyback transport (2026-06 challenge mitigation) ────────────────────────
 * As of ~2026-06-11 SofaScore challenges direct /api/v1 calls AND deep-link page
 * navigations (match/tournament pages → 403 on the HTML). Only entry pages load, and
 * their own SPA JS makes /api/v1 calls that DO pass (it computes the per-request
 * x-requested-with signature we can't replicate). So instead of requesting endpoints
 * ourselves, we let the SPA request them and harvest its responses.
 *
 * `harvest(navigate, want)`: capture every /api/v1 response body whose path matches
 * `want` while `navigate` drives the page (SPA click / in-app routing). Routed through
 * the polite queue like getJson. `warmEntry()` lands on an allowed entry page once per
 * process so the SPA is hydrated before we drive it.
 *
 * NOT YET WIRED INTO refresh/enrich: the orchestration (which entry page, which links to
 * click to reach each match/standings view) needs live calibration against the SPA, which
 * is blocked until the egress IP cools down (see docs/09; prefer SOFA_VIA_IPHONE for a
 * fresh IP). See sofascore-challenge-block memory for the validation checklist. */

const API_RE = /^https:\/\/(?:www|api)\.sofascore\.com(\/api\/v1\/.+)$/;
let warmed = false;

/**
 * Land on an allowed entry page once per process so the SPA session is established.
 *
 * The challenge is per-request (a 403 here is often transient), so we retry through the
 * polite client — but a persistent 403 must NOT abort the run: we log and proceed anyway.
 * harvestMatchView routes client-side (pushState), which can still slip through, and any
 * match that yields nothing is simply skipped by the caller, not fatal. Mirrors the
 * tolerant `harvest()` path that refresh uses successfully.
 */
export async function warmEntry(entryPath = '/football'): Promise<void> {
  if (warmed) return;
  try {
    await client.run(async () => {
      const p = await ensurePage();
      const resp = await p.goto(`https://www.sofascore.com${entryPath}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      const status = resp?.status() ?? 0;
      if (status === 403 || status === 429) {
        throw new RateLimitedError(status, parseRetryAfter(resp?.headers()['retry-after']));
      }
      await p.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    }, `warm ${entryPath}`);
  } catch (err) {
    const name = err instanceof Error ? err.name : 'error';
    console.warn(`[browser] warm ${entryPath} did not settle (${name}); proceeding to match views anyway`);
  }
  // Mark warmed regardless: don't re-hammer the entry page before every match view.
  warmed = true;
}

export interface HarvestHit {
  status: number;
  body?: unknown;
}

/**
 * Drive the SPA via `navigate` and capture /api/v1 response bodies whose path matches
 * `want`. Returns a map keyed by API path (query string stripped). `settleMs` lets late
 * XHRs land after navigation settles. The capture itself never throws on a single bad
 * response; a 403 on the *navigation* surfaces via RateLimitedError from `navigate`.
 */
export async function harvest(
  navigate: (page: Page) => Promise<void>,
  want: RegExp,
  settleMs = 6000,
): Promise<Map<string, HarvestHit>> {
  return client.run(async () => {
    const p = await ensurePage();
    const hits = new Map<string, HarvestHit>();
    const pending: Promise<void>[] = [];
    const onResponse = (resp: PWResponse): void => {
      const m = resp.url().match(API_RE);
      if (!m) return;
      const path = m[1]!.split('?')[0]!;
      if (!want.test(path)) return;
      const status = resp.status();
      if (status !== 200) {
        hits.set(path, { status });
        return;
      }
      pending.push(
        resp
          .json()
          .then((body: unknown) => void hits.set(path, { status, body }))
          .catch(() => void hits.set(path, { status })),
      );
    };
    p.on('response', onResponse);
    try {
      await navigate(p);
      await p.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      await sleep(settleMs);
      await Promise.allSettled(pending);
    } finally {
      p.off('response', onResponse);
    }
    return hits;
  }, 'harvest');
}

/**
 * Open one match's view inside the already-warm SPA (client-side route — dodges the
 * deep-link 403) and harvest its per-match /api/v1 responses. Routes by clicking an
 * existing link to the match if the entry page lists it, else via History pushState
 * (the SPA router listens to popstate). Scrolls to coax lazy sections. Returns the
 * captured bodies keyed by API path. Call `warmEntry()` once before the first match.
 *
 * Reliable: /event/{id}/{lineups,odds,votes,incidents}. The Statistics sub-tab
 * (/statistics, /shotmap) does not fire from the summary view — captured opportunistically
 * if present, otherwise absent (docs/15 follow-up).
 */
export async function harvestMatchView(
  m: { eventId: number; slug: string; customId: string },
  want: RegExp,
): Promise<Map<string, HarvestHit>> {
  return client.run(async () => {
    const p = await ensurePage();
    const hits = new Map<string, HarvestHit>();
    const pending: Promise<void>[] = [];
    const onResponse = (resp: PWResponse): void => {
      const mm = resp.url().match(API_RE);
      if (!mm) return;
      const path = mm[1]!.split('?')[0]!;
      if (!want.test(path)) return;
      if (resp.status() !== 200) {
        hits.set(path, { status: resp.status() });
        return;
      }
      pending.push(
        resp
          .json()
          .then((body: unknown) => void hits.set(path, { status: 200, body }))
          .catch(() => void hits.set(path, { status: resp.status() })),
      );
    };
    p.on('response', onResponse);
    try {
      await p.evaluate(
        ({ slug, customId, eventId }) => {
          // runs in the browser; globalThis-as-any avoids pulling the DOM lib into Node tsc
          const g = globalThis as any;
          const link = g.document.querySelector(`a[href*="/match/${slug}/"]`);
          if (link) link.click();
          else {
            g.history.pushState({}, '', `/football/match/${slug}/${customId}#id:${eventId}`);
            g.dispatchEvent(new g.PopStateEvent('popstate'));
          }
        },
        { slug: m.slug, customId: m.customId, eventId: m.eventId },
      );
      await p.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      await sleep(3000);
      for (let i = 0; i < 6; i++) {
        await p.mouse.wheel(0, 1400).catch(() => undefined);
        await sleep(900);
      }
      await Promise.allSettled(pending);
    } finally {
      p.off('response', onResponse);
    }
    return hits;
  }, `match ${m.eventId}`);
}

/** Tear down Chrome. Call once at the end of a run. */
export async function closeBrowser(): Promise<void> {
  warmed = false;
  if (browser) await browser.close();
  if (sourceProxy) sourceProxy.close();
  browser = undefined;
  context = undefined;
  page = undefined;
  launching = undefined;
  sourceProxy = undefined;
}
