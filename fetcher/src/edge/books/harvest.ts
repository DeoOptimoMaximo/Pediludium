import type { Browser, Page, Response as PWResponse } from 'playwright-core';
import { chromium } from 'playwright-core';
import { config } from '../../config.ts';

/**
 * Generic XHR-harvester for arbitrary hosts (HR sportsbooks). Mirrors browser.ts but isn't
 * bound to the SofaScore API host: drives the real installed Chrome (so the TLS fingerprint
 * is a genuine browser) through the same egress proxy (SOFA_PROXY_SERVER → iPhone/Telemach
 * cellular IP, which also satisfies any Croatia geo-gating), navigates the SPA entry page,
 * and captures every JSON response whose URL matches `want`.
 */
export interface HarvestedResponse {
  url: string;
  status: number;
  body?: unknown;
}

export async function harvestJson(
  entryUrl: string,
  want: RegExp,
  settleMs = 7000,
): Promise<HarvestedResponse[]> {
  const proxyServer = config.proxyServer;
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: process.env.SOFA_HEADLESS === '1',
      ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
    });
    const context = await browser.newContext({ locale: 'hr-HR' });
    const page: Page = await context.newPage();
    const hits: HarvestedResponse[] = [];
    const pending: Promise<void>[] = [];
    const onResponse = (resp: PWResponse): void => {
      const url = resp.url();
      if (!want.test(url)) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!/json/i.test(ct)) {
        hits.push({ url, status: resp.status() });
        return;
      }
      pending.push(
        resp
          .json()
          .then((body: unknown) => void hits.push({ url, status: resp.status(), body }))
          .catch(() => void hits.push({ url, status: resp.status() })),
      );
    };
    page.on('response', onResponse);
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, settleMs));
    await Promise.allSettled(pending);
    page.off('response', onResponse);
    return hits;
  } finally {
    if (browser) await browser.close();
  }
}
