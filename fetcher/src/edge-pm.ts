import { closeDb } from './db.ts';
import { collectPolymarketQuotes } from './edge/polymarket.ts';
import { upsertQuote } from './edge/db.ts';

/**
 * Ingest Polymarket (Web3) odds for WC2026 fixtures into public.edge_quote.
 * Read-only against Gamma + CLOB (no wallet / no auth). Safe to re-run.
 *   npm run edge:pm
 */
async function main(): Promise<void> {
  console.log('\n=== Pediludium edge · Polymarket ingest ===\n');
  const events = await collectPolymarketQuotes(true);
  let written = 0;
  for (const ev of events) {
    for (const q of ev.quotes) {
      await upsertQuote(q, ev.fixtureMatchId);
      written++;
    }
    console.log(
      `[pm] ${ev.eventTitle} → match ${ev.fixtureMatchId}: ${ev.quotes
        .map((q) => `${q.selection} ${q.decimalOdds.toFixed(2)}`)
        .join(' · ')}`,
    );
  }
  console.log(`\n=== Polymarket: ${written} quotes across ${events.length} matched events ===\n`);
}

main()
  .catch((err) => {
    console.error('[pm] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
