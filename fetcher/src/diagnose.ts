import { chromium } from 'playwright-core';

/**
 * Block diagnosis (`node src/diagnose.ts`) — when the API starts 403-ing, this tells us
 * WHICH layer is blocking (docs/09): the whole IP, the api. host, or bare navigation
 * without site context. Four polite probes (~15 s total):
 *   1. load https://www.sofascore.com         → 403 here = IP-level ban
 *   2. in-page fetch /api/v1 on www host       → same-origin XHR with site cookies
 *   3. in-page fetch /api/v1 on api host       → cross-origin XHR with site context
 *   4. bare page.goto to api host              → what browser.ts does today
 */

const PROBE_PATH = '/api/v1/unique-tournament/16/seasons';

async function main(): Promise<void> {
  const proxyServer = process.env.SOFA_PROXY_SERVER;
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.SOFA_HEADLESS === '1',
    ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
  });
  if (proxyServer) console.log(`[diagnose] egress via ${proxyServer}`);
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  const pause = () => new Promise((r) => setTimeout(r, 2500 + Math.random() * 1500));

  try {
    const site = await page.goto('https://www.sofascore.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    console.log(`[1] site www.sofascore.com → ${site?.status()}`);
    await pause();

    for (const host of ['https://www.sofascore.com', 'https://api.sofascore.com']) {
      const r = await page.evaluate(async (url) => {
        try {
          const resp = await fetch(url, { headers: { accept: 'application/json' } });
          const body = await resp.text();
          return { status: resp.status, snippet: body.slice(0, 80) };
        } catch (e) {
          return { status: -1, snippet: String(e).slice(0, 80) };
        }
      }, `${host}${PROBE_PATH}`);
      console.log(`[2/3] in-page fetch ${host}${PROBE_PATH} → ${r.status} ${r.snippet}`);
      await pause();
    }

    const bare = await page.goto(`https://api.sofascore.com${PROBE_PATH}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    console.log(`[4] bare goto api.sofascore.com${PROBE_PATH} → ${bare?.status()}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[diagnose] fatal:', err);
  process.exitCode = 1;
});
