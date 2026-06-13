import { closeDb } from './db.ts';
import { config } from './config.ts';
import { ensureWallet } from './edge/db.ts';
import { runPaperTrades, settlePaperTrades } from './edge/paper-trade.ts';

/**
 * Dry-run trading experiment: settle any finished positions, then open new SIMULATED
 * positions from the current open +EV opportunities. No funds move while EDGE_DRY_RUN=true.
 *   npm run edge:trade
 */
async function main(): Promise<void> {
  console.log(`\n=== Pediludium edge · paper trade (DRY_RUN=${config.edgeDryRun}) ===\n`);
  const settle = await settlePaperTrades();
  if (settle.settled) console.log(`[trade] settled ${settle.settled} positions · P&L $${settle.pnl.toFixed(2)}`);

  const r = await runPaperTrades();
  const wallet = await ensureWallet('paper', config.edgePaperBankrollUsd);
  console.log(
    `\n[trade] placed ${r.placed} · skipped ${r.skipped} of ${r.considered} considered` +
      (r.haltedReason ? ` · halted: ${r.haltedReason}` : ''),
  );
  console.log(
    `[trade] paper wallet: $${wallet.balance_usd.toFixed(2)} (start $${wallet.starting_usd.toFixed(2)})\n`,
  );
}

main()
  .catch((err) => {
    console.error('[trade] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
