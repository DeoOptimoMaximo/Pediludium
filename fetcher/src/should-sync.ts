import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { alert } from './alert.ts';
import { closeDb } from './db.ts';
import { loadDueMatches, loadSeasonProgress, recordHeartbeat, STRANDED_AFTER_D } from './ops.ts';

/**
 * Schedule-aware gate for the frequent match-sync job (scripts/match-sync.sh).
 *
 *   exit 0  = at least one match is due a result check (worth spending Firecrawl credits)
 *   exit 10 = nothing due → skip (0 credits, 0 work)
 *
 * WHAT CHANGED (docs/21 §2B): eligibility used to be a wall-clock window, [now-18h, now+15m].
 * That silently discards work. During the 2026-06/07 outages Postgres was unreachable for up to
 * six days at a time; by the time it answered again, the matches played meanwhile had aged out of
 * the window and were never checked again — five World Cup results (2× R16, 3× QF) simply never
 * landed, and nothing anywhere said so.
 *
 * Eligibility is now a function of match STATE, not of the clock: "kicked off, still not finished
 * in our DB, not yet stranded, and its own backoff has expired" (src/ops.ts). A match played
 * during an outage is due the instant the database comes back — catch-up is the default rather
 * than a manual REFRESH_FC_SINCE_H widening someone has to remember to run.
 *
 * The DB being unreachable still SKIPS the tick (fail-safe: a dead DB must never burn credits),
 * but it is no longer silent — after CONSEC_FAIL_ALERT consecutive failures it raises an alert
 * through the file-backed, DB-free path in alert.ts.
 */

const EXIT_PROCEED = 0;
const EXIT_SKIP = 10;

const STATE_DIR = path.resolve(import.meta.dirname, '..', 'snapshot');
const FAIL_FILE = path.join(STATE_DIR, '.sync-gate-failures.json');
/** ~1h of 15-min ticks: long enough to ride out a Docker restart, short enough to matter. */
const CONSEC_FAIL_ALERT = Number(process.env.SYNC_GATE_FAIL_ALERT ?? 4);

async function bumpFailures(err: unknown): Promise<number> {
  let n = 0;
  try {
    if (existsSync(FAIL_FILE)) n = Number(JSON.parse(await readFile(FAIL_FILE, 'utf8')).consecutive ?? 0);
  } catch { /* corrupt counter → start over rather than crash the gate */ }
  n += 1;
  await mkdir(STATE_DIR, { recursive: true }).catch(() => {});
  await writeFile(
    FAIL_FILE,
    JSON.stringify({ consecutive: n, lastError: String(err).slice(0, 200), at: new Date().toISOString() }),
  ).catch(() => {});
  return n;
}

async function clearFailures(): Promise<void> {
  if (existsSync(FAIL_FILE)) await writeFile(FAIL_FILE, JSON.stringify({ consecutive: 0 })).catch(() => {});
}

async function main(): Promise<number> {
  const [due, season] = await Promise.all([loadDueMatches(), loadSeasonProgress()]);
  await clearFailures();
  // Liveness beat for the health check. Deliberately recorded on SKIP as well as PROCEED: this
  // gate runs every 15 minutes and can only get here if Postgres answered, which makes it the
  // one signal that stays fresh in a healthy but idle system (an archived season legitimately
  // has nothing to fetch for months). Hanging liveness off refresh:fc instead would mean a
  // finished tournament looked identical to a broken ingest — an alarm that cries wolf forever.
  await recordHeartbeat('sync-gate', true, { due: due.length, frozen: season.complete });

  // An archived season is a distinct kind of quiet from "between matchdays", and the log has to
  // say which — a SKIP that reads the same either way is exactly what made the 2026-06/07 outages
  // take a month to notice. The job is NOT disabled: it keeps ticking (and keeps the heartbeat
  // fresh) so the same launchd plumbing drives the next competition without being re-armed.
  if (season.complete) {
    console.log(
      `[sync-gate] SKIP — sezona arhivirana (${season.played}/${season.total} odigrano), nema više posla`,
    );
    return EXIT_SKIP;
  }
  if (due.length === 0) {
    console.log('[sync-gate] SKIP — nijedna utakmica nije na redu za provjeru');
    return EXIT_SKIP;
  }
  const names = due
    .map((r) => `${r.home ?? '?'} v ${r.away ?? '?'}${r.attempts > 0 ? ` (pokušaj ${r.attempts + 1})` : ''}`)
    .join(', ');
  console.log(`[sync-gate] PROCEED — ${due.length} utakmica na redu: ${names}`);
  return EXIT_PROCEED;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch(async (err) => {
    const n = await bumpFailures(err);
    console.error(`[sync-gate] fatal (${n}. uzastopno): ${String(err).slice(0, 200)}`);
    if (n >= CONSEC_FAIL_ALERT) {
      await alert(
        'db-down',
        'Pediludium 🔴 sync-gate ne može do baze',
        `${n} uzastopnih tickova bez baze (${String(err).slice(0, 120)}).\n` +
          `Utakmice starije od ${STRANDED_AFTER_D} dana ispadaju iz catch-upa.\n` +
          'Popravak: open -a Docker && cd Pediludium && supabase start',
      );
    }
    process.exitCode = 1; // shell treats non-zero as skip (fail safe, no credit spend)
  })
  .finally(async () => {
    await closeDb();
  });
