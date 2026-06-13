import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, dbQuery } from './db.ts';

/**
 * Change gate for the hourly snapshot pipeline (scripts/hourly-snapshot.sh).
 *
 * Why this exists: the Dixon-Coles fit uses wall-clock time-decay (half-life 540d,
 * dixon-coles.ts reads Date.now()), so predict:dc → simulate drift by a hair EVERY
 * hour even when no match changed. That drift flips the 4th decimal of ~50 series
 * shards (tser:* + mser:*), so a blind hourly publish wrote ~50 KV keys/tick × 24 =
 * ~1200/day — over Cloudflare KV's free-tier limit of 1000 writes/day (→ 429 + a daily
 * "limit exceeded" email). An hour of 540-day decay is noise, not signal.
 *
 * The fix: only recompute + publish when *match reality* actually changed (a score,
 * a status flip, a schedule/bracket change) or a match is live, or when forced. The
 * digest is over raw match columns ONLY — never model outputs or timestamps — so
 * pure time-decay drift no longer triggers a publish. Quiet hours cost 0 KV writes.
 *
 *   check    exit 0 = PROCEED (recompute + publish), exit 10 = SKIP. Prints the reason.
 *   commit   persist the current digest as "last published" — call ONLY after a
 *            successful publish, so a failed publish (e.g. KV 429) retries next tick.
 *
 * Override: FORCE_PUBLISH=1 always proceeds (e.g. after a model/schema change that
 * legitimately needs a republish without a match change).
 */

const SNAP_DIR = path.resolve(import.meta.dirname, '..', 'snapshot');
const DIGEST_FILE = path.join(SNAP_DIR, '.last-publish-digest');

const EXIT_PROCEED = 0;
const EXIT_SKIP = 10;

/** md5 over the match columns that represent reality — not model output, not wall clock. */
async function currentState(): Promise<{ digest: string; live: number }> {
  const rows = await dbQuery<{ digest: string; live: number }>(
    `select coalesce(md5(string_agg(
              ss_id || '|' || coalesce(status_type, '') || '|' || coalesce(status_code::text, '')
              || '|' || coalesce(home_score::text, '') || '|' || coalesce(away_score::text, '')
              || '|' || coalesce(winner_code::text, '') || '|' || coalesce(round::text, '')
              || '|' || coalesce(start_ts::text, ''),
              E'\n' order by ss_id)), 'empty') as digest,
            count(*) filter (where status_type = 'inprogress')::int as live
       from public.wc2026_match`,
  );
  return rows[0] ?? { digest: 'empty', live: 0 };
}

async function lastDigest(): Promise<string | null> {
  if (!existsSync(DIGEST_FILE)) return null;
  return (await readFile(DIGEST_FILE, 'utf8')).trim();
}

async function check(): Promise<number> {
  const { digest, live } = await currentState();

  if (process.env.FORCE_PUBLISH === '1') {
    console.log('[gate] PROCEED — FORCE_PUBLISH=1');
    return EXIT_PROCEED;
  }
  if (live > 0) {
    console.log(`[gate] PROCEED — ${live} match(es) live`);
    return EXIT_PROCEED;
  }
  const prev = await lastDigest();
  if (prev === null) {
    console.log('[gate] PROCEED — no prior published digest');
    return EXIT_PROCEED;
  }
  if (prev !== digest) {
    console.log('[gate] PROCEED — match reality changed since last publish');
    return EXIT_PROCEED;
  }
  console.log('[gate] SKIP — no match change since last publish (model drift only)');
  return EXIT_SKIP;
}

async function commit(): Promise<number> {
  const { digest } = await currentState();
  await writeFile(DIGEST_FILE, digest + '\n');
  console.log(`[gate] committed digest ${digest.slice(0, 12)}…`);
  return EXIT_PROCEED;
}

const mode = process.argv[2];
const run =
  mode === 'check' ? check() :
  mode === 'commit' ? commit() :
  Promise.reject(new Error('usage: should-publish.ts <check|commit>'));

run
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[gate] fatal:', err);
    process.exitCode = 1; // unexpected error → treated as SKIP by the shell (fail safe)
  })
  .finally(async () => {
    await closeDb();
  });
