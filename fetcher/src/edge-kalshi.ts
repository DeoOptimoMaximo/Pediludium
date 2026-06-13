import { closeDb } from './db.ts';
import { collectKalshiQuotes } from './edge/kalshi.ts';
import { upsertQuote } from './edge/db.ts';

/**
 * Ingest Kalshi (regulated event-exchange) WC match-winner odds into public.edge_quote.
 * Read-only, no auth. A second venue alongside Polymarket → enables real arbitrage.
 *   npm run edge:kalshi
 */
async function main(): Promise<void> {
  console.log('\n=== Pediludium edge · Kalshi ingest ===\n');
  const events = await collectKalshiQuotes();
  let written = 0;
  for (const ev of events) {
    for (const q of ev.quotes) {
      await upsertQuote(q, ev.fixtureMatchId);
      written++;
    }
    console.log(
      `[kalshi] match ${ev.fixtureMatchId}: ${ev.quotes
        .map((q) => `${q.selection} ${q.decimalOdds.toFixed(2)}`)
        .join(' · ')}`,
    );
  }
  console.log(`\n=== Kalshi: ${written} quotes across ${events.length} matched events ===\n`);
}

main()
  .catch((err) => {
    console.error('[kalshi] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
