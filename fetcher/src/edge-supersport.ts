import { readFileSync } from 'node:fs';
import { closeDb } from './db.ts';
import { collectSupersportQuotes } from './edge/supersport.ts';
import { upsertQuote } from './edge/db.ts';

/**
 * Ingest SuperSport (Web2 / Croatian book) 1X2 odds into public.edge_quote.
 * Drives the proxied Chrome + harvests the api/sbk WebSocket. Needs SOFA_PROXY_SERVER
 * (Croatian cellular IP) live.
 *   npm run edge:supersport
 */
async function main(): Promise<void> {
  console.log('\n=== Pediludium edge · SuperSport ingest ===\n');
  // optional: replay captured WS frames from a file (fallback when the proxy is asleep)
  const file = process.argv[2];
  const frames = file ? (JSON.parse(readFileSync(file, 'utf8')) as string[]) : undefined;
  if (file) console.log(`[supersport] replaying frames from ${file}`);
  const events = await collectSupersportQuotes(frames);
  let written = 0;
  for (const ev of events) {
    for (const q of ev.quotes) {
      await upsertQuote(q, ev.fixtureMatchId);
      written++;
    }
    console.log(
      `[supersport] match ${ev.fixtureMatchId}: ${ev.quotes
        .map((q) => `${q.selection} ${q.decimalOdds.toFixed(2)}`)
        .join(' · ')}`,
    );
  }
  console.log(`\n=== SuperSport: ${written} quotes across ${events.length} matched events ===\n`);
}

main()
  .catch((err) => {
    console.error('[supersport] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
