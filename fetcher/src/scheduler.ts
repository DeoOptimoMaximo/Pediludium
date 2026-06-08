import { WORLD_CUP } from './config.ts';
import { jitter, sleep } from './politeness.ts';
import { closeBrowser } from './browser.ts';
import { closeDb, dbQuery } from './db.ts';
import { activeMatchIds, refreshActive, refreshSchedule } from './refresh.ts';

/**
 * Persistent phase-aware scheduler (docs/03). Runs forever on the home machine
 * (residential IP, one shared Chrome). Picks cadence by tournament state:
 *   LIVE      (any inprogress)            → ~30s
 *   PREMATCH  (match within ~60min)       → ~5min
 *   IDLE      (nothing soon)              → ~30min + one full schedule refresh / day
 * Resumable: all state lives in the DB, so a restart just re-reads "what's active now".
 * Run under launchd/pm2/systemd for auto-restart. Stop with Ctrl-C (graceful).
 */

const S = WORLD_CUP.seasonId2026;

let stop = false;
const requestStop = () => {
  stop = true;
};
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);

async function liveCount(): Promise<number> {
  const rows = await dbQuery<{ n: string }>(
    `select count(*) n from public.match where season_id=$1 and status_type='inprogress'`,
    [S],
  );
  return Number(rows[0]?.n ?? 0);
}

async function main(): Promise<void> {
  console.log('[scheduler] starting — initial schedule refresh…');
  await refreshSchedule();
  let lastFullDay = new Date().toISOString().slice(0, 10);

  while (!stop) {
    const [live, active] = await Promise.all([liveCount(), activeMatchIds()]);

    let cadenceMs: number;
    let phase: string;
    if (live > 0) {
      cadenceMs = jitter(25_000, 40_000);
      phase = 'LIVE';
    } else if (active.length > 0) {
      cadenceMs = jitter(4 * 60_000, 6 * 60_000);
      phase = 'PREMATCH';
    } else {
      cadenceMs = jitter(25 * 60_000, 35 * 60_000);
      phase = 'IDLE';
    }

    // once per UTC day, when nothing is live, re-pull the whole schedule
    const day = new Date().toISOString().slice(0, 10);
    if (live === 0 && day !== lastFullDay) {
      const n = await refreshSchedule();
      lastFullDay = day;
      console.log(`[scheduler] daily schedule refresh: ${n} matches`);
    }

    const updated = await refreshActive();
    console.log(
      `[scheduler] ${phase}: live=${live} active=${active.length} updated=${updated} → next in ${Math.round(cadenceMs / 1000)}s`,
    );

    // interruptible sleep so Ctrl-C is snappy
    const until = Date.now() + cadenceMs;
    while (!stop && Date.now() < until) await sleep(Math.min(1000, until - Date.now()));
  }

  console.log('[scheduler] stopping (graceful)…');
}

main()
  .catch((err) => {
    console.error('[scheduler] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await closeDb();
  });
