import { closeDb } from './db.ts';
import { scan } from './edge/engine.ts';

/**
 * Run the +EV / arbitrage engine over the latest edge_quote snapshot.
 *   npm run edge:scan
 * Re-marks prior open opportunities stale, then writes the fresh set.
 */
async function main(): Promise<void> {
  console.log('\n=== Pediludium edge · scan (+EV / arbitrage) ===\n');
  const r = await scan();
  console.log(
    `[scan] fair probs written: ${r.fairWrites} · +EV opps: ${r.evCount} · arbitrage opps: ${r.arbCount}\n`,
  );
}

main()
  .catch((err) => {
    console.error('[scan] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
