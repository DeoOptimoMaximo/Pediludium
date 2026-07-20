import { closeDb } from './db.ts';
import { loadSeasonProgress } from './ops.ts';

/**
 * Freeze gate for the hourly full refresh (scripts/hourly-snapshot.sh).
 *
 *   exit 0  = the season is still live → refresh the schedule and results
 *   exit 10 = the season is archived → skip (0 network, 0 credits)
 *
 * WHY THIS EXISTS (docs/21 §3B): every other stage of the pipeline already had a gate.
 * `refresh --full` did not — it fired every hour regardless, and after the final it was
 * still opening Chrome and dialling a dead mobile proxy sixty times a day to re-fetch a
 * tournament that cannot change again. Harmless, but it is noise in the logs at exactly
 * the place where forensics has to be readable, and it would be real cost the moment the
 * proxy came back.
 *
 * What this is NOT: an off switch. The launchd jobs keep running on their normal cadence
 * (docs/22 §1). A frozen season simply gives them nothing to do, and the instant a new
 * competition is onboarded with unplayed fixtures the same gate opens again — which is the
 * whole point, because §4 hands these jobs the next competition without re-arming anything.
 *
 * The completeness rule itself lives in ops.ts (`isSeasonComplete`) and is shared with the
 * sync gate and the snapshot exporter, so "archived" can never mean two different things in
 * two places.
 */

const EXIT_PROCEED = 0;
const EXIT_SKIP = 10;

async function main(): Promise<number> {
  const season = await loadSeasonProgress();

  if (season.complete) {
    console.log(
      `[refresh-gate] SKIP — sezona arhivirana (${season.played}/${season.total} odigrano)`,
    );
    return EXIT_SKIP;
  }
  console.log(
    `[refresh-gate] PROCEED — sezona u tijeku (${season.played}/${season.total} odigrano)`,
  );
  return EXIT_PROCEED;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Fail OPEN, unlike the sync gate. A refresh costs no Firecrawl credits, and the failure
    // mode we must avoid is a database hiccup silently freezing a live competition. The sync
    // gate's own alerting already covers "the DB is unreachable".
    console.error(`[refresh-gate] fatal, nastavljam s refreshom: ${String(err).slice(0, 200)}`);
    process.exitCode = EXIT_PROCEED;
  })
  .finally(async () => {
    await closeDb();
  });
