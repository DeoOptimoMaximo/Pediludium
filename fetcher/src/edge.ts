import { closeDb } from './db.ts';
import { config } from './config.ts';
import { collectPolymarketQuotes } from './edge/polymarket.ts';
import { upsertQuote, ensureWallet } from './edge/db.ts';
import { scan } from './edge/engine.ts';
import { runPaperTrades, settlePaperTrades } from './edge/paper-trade.ts';

/**
 * One-shot edge pipeline: Polymarket ingest → engine scan (+EV/arb) → dry-run trade.
 * Each step is isolated so a single failure leaves a stale-but-consistent state (same
 * philosophy as scripts/hourly-snapshot.sh). HR books are run separately once calibrated.
 *   npm run edge
 */
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.warn(`[edge] step '${name}' failed: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log(`\n=== Pediludium edge pipeline (DRY_RUN=${config.edgeDryRun}) ===\n`);

  await step('polymarket', async () => {
    const events = await collectPolymarketQuotes(true);
    let n = 0;
    for (const ev of events) for (const q of ev.quotes) (await upsertQuote(q, ev.fixtureMatchId), n++);
    console.log(`[edge] polymarket: ${n} quotes / ${events.length} matched events`);
  });

  await step('scan', async () => {
    const r = await scan();
    console.log(`[edge] scan: ${r.evCount} +EV · ${r.arbCount} arb · ${r.fairWrites} fair probs`);
  });

  await step('trade', async () => {
    const s = await settlePaperTrades();
    if (s.settled) console.log(`[edge] settled ${s.settled} · P&L $${s.pnl.toFixed(2)}`);
    const t = await runPaperTrades();
    const w = await ensureWallet('paper', config.edgePaperBankrollUsd);
    console.log(`[edge] trade: placed ${t.placed} · wallet $${w.balance_usd.toFixed(2)}`);
  });

  console.log('\n=== edge pipeline done ===\n');
}

main()
  .catch((err) => {
    console.error('[edge] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
