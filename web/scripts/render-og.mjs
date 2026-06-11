// Renders og-template.html -> public/og.png (1200x630) via headless Chrome.
// Run from web/: node scripts/render-og.mjs   (uses fetcher's playwright-core)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(webDir, '..', 'fetcher', 'package.json'));
const { chromium } = require('playwright-core');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(webDir, 'og-template.html'));
await page.waitForLoadState('networkidle');
const out = path.join(webDir, 'public', 'og.png');
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
