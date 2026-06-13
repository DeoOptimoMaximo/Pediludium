import { closeDb } from './db.ts';
import { upsertQuote } from './edge/db.ts';
import { matchEvent } from './edge/match-link.ts';
import { harvestJson } from './edge/books/harvest.ts';
import { BOOKS } from './edge/books/registry.ts';

/**
 * Ingest Croatian sportsbook (Web2) odds into edge_quote.
 *   npm run edge:books -- supersport psk      # discover+harvest only the named books
 *   npm run edge:books                         # list adapters (no browser launched)
 *
 * Launches the proxied Chrome only for explicitly-named books (the parsers are still being
 * calibrated, so a bare run just shows the registry). Discovery logs the candidate odds XHR
 * endpoints — that's the input for writing each book's `parse` (docs/16).
 */
async function main(): Promise<void> {
  const targets = process.argv.slice(2).map((s) => s.toLowerCase());
  console.log('\n=== Pediludium edge · HR sportsbook ingest ===\n');

  if (!targets.length) {
    console.log('Configured adapters (pass ids as args to discover/harvest):');
    for (const b of BOOKS) console.log(`  · ${b.id.padEnd(11)} ${b.displayName}  ${b.entryUrl}`);
    console.log('\nExample: npm run edge:books -- supersport psk\n');
    return;
  }

  for (const b of BOOKS.filter((x) => targets.includes(x.id))) {
    console.log(`[books] ${b.id}: harvesting ${b.entryUrl}`);
    let hits: Awaited<ReturnType<typeof harvestJson>> = [];
    try {
      hits = await harvestJson(b.entryUrl, b.offerPattern);
    } catch (err) {
      console.warn(`[books] ${b.id}: harvest failed — ${(err as Error).message}`);
      continue;
    }
    const withJson = hits.filter((h) => h.body !== undefined);
    console.log(`[books] ${b.id}: ${hits.length} matching XHR (${withJson.length} JSON). Candidates:`);
    for (const h of hits.slice(0, 12)) console.log(`    ${h.status} ${h.url.slice(0, 120)}`);

    let written = 0;
    for (const h of withJson) {
      const quotes = b.parse(h.body, h.url);
      for (const q of quotes) {
        const fm = q.homeName && q.awayName ? await matchEvent(q.homeName, q.awayName) : null;
        await upsertQuote(q, fm ? fm.fixture.matchId : null);
        written++;
      }
    }
    console.log(`[books] ${b.id}: ${written} quotes written` + (written ? '' : ' (parse not yet calibrated)'));
  }
}

main()
  .catch((err) => {
    console.error('[books] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
