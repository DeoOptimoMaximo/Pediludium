import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { closeDb, dbQuery } from './db.ts';
import { WORLD_CUP } from './config.ts';

/**
 * Fallback result sync via Firecrawl (`npm run refresh:fc`).
 *
 * When the mobile-proxy piggyback is challenge-blocked (refresh upserts 0), fresh match
 * RESULTS can't land — the public scorecard goes stale. Firecrawl can render the public
 * match page even when our egress is blocked, so we use structured extraction (LLM reads
 * the rendered page) to pull {home_score, away_score, status} for matches that have started
 * but aren't 'finished' in our DB, and update them. Scores/status only — never touches the
 * fixtures/teams. ~5 credits/match; only runs on the handful of matches actually in play.
 *
 * After this, re-run standings → predict:dc → simulate → snapshot to publish.
 */

const S = WORLD_CUP.seasonId2026;
const MAX = Number(process.env.REFRESH_FC_MAX ?? 12);
const DRY = process.env.REFRESH_FC_DRY === '1';

const SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    home_team: { type: 'string' },
    away_team: { type: 'string' },
    home_score: { type: ['integer', 'null'], description: 'current home team goals; null if not started' },
    away_score: { type: ['integer', 'null'], description: 'current away team goals; null if not started' },
    status: { type: 'string', enum: ['notstarted', 'inprogress', 'finished'], description: 'current match status' },
  },
});

interface Cand {
  ss_id: number;
  slug: string;
  cid: string;
  home: string | null;
  away: string | null;
  status_type: string | null;
}

async function loadCandidates(): Promise<Cand[]> {
  const rows = await dbQuery<Omit<Cand, 'ss_id'> & { ss_id: string }>(
    `select m.ss_id, m.raw->>'slug' as slug, m.raw->>'customId' as cid,
            m.raw->'homeTeam'->>'name' as home, m.raw->'awayTeam'->>'name' as away, m.status_type
       from public.match m
      where m.season_id = $1 and m.raw->>'slug' is not null and m.raw->>'customId' is not null
        and m.start_ts < now() + interval '30 minutes'
        and m.start_ts > now() - interval '60 hours'
        and m.status_type is distinct from 'finished'
      order by m.start_ts`,
    [S],
  );
  return rows.map((r) => ({ ...r, ss_id: Number(r.ss_id) }));
}

interface Extracted {
  home_score: number | null;
  away_score: number | null;
  status: 'notstarted' | 'inprogress' | 'finished';
}

/** Scrape a match page with schema extraction; return the parsed result JSON or null. */
function scrapeResult(url: string): Extracted | null {
  const out = path.join(tmpdir(), `fcres-${Math.abs(hashCode(url))}.json`);
  const res = spawnSync(
    'firecrawl',
    ['scrape', url, '--format', 'json', '--schema', SCHEMA, '--country', 'HR', '--wait-for', '5000', '-o', out],
    { encoding: 'utf8', timeout: 90_000 },
  );
  if (res.status !== 0) {
    console.warn(`[refresh:fc] scrape failed (${res.status}): ${String(res.stderr).slice(0, 120)}`);
    return null;
  }
  try {
    const txt = res.stdout + '\n' + (spawnSync('cat', [out], { encoding: 'utf8' }).stdout ?? '');
    const line = txt.split('\n').find((l) => l.trim().startsWith('{') && l.includes('"json"'));
    const obj = JSON.parse((line ?? '{}').trim());
    const j = obj.json ?? obj;
    if (!j || typeof j.status !== 'string') return null;
    return { home_score: j.home_score ?? null, away_score: j.away_score ?? null, status: j.status };
  } catch (e) {
    console.warn(`[refresh:fc] parse failed: ${String(e).slice(0, 100)}`);
    return null;
  } finally {
    void rm(out, { force: true });
  }
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Update only score + status (+ derived winner_code/status_code) — never fixtures/teams. */
async function applyResult(c: Cand, e: Extracted): Promise<boolean> {
  if (e.status === 'notstarted' || e.home_score == null || e.away_score == null) return false;
  const winner = e.status === 'finished'
    ? (e.home_score > e.away_score ? 1 : e.home_score < e.away_score ? 2 : 3)
    : null;
  const statusCode = e.status === 'finished' ? 100 : null;
  if (DRY) return true;
  await dbQuery(
    `update public.match
        set home_score = $2, away_score = $3, status_type = $4,
            status_code = coalesce($5, status_code),
            winner_code = coalesce($6, winner_code),
            fetched_at = now()
      where ss_id = $1`,
    [c.ss_id, e.home_score, e.away_score, e.status, statusCode, winner],
  );
  return true;
}

async function main(): Promise<void> {
  const cands = (await loadCandidates()).slice(0, MAX);
  if (cands.length === 0) {
    console.log('[refresh:fc] no in-play/recent matches to update');
    return;
  }
  console.log(`[refresh:fc] checking ${cands.length} matches via Firecrawl${DRY ? ' (DRY RUN)' : ''}`);
  let updated = 0;
  for (const c of cands) {
    const url = `https://www.sofascore.com/football/match/${c.slug}/${c.cid}`;
    const e = scrapeResult(url);
    if (!e) {
      console.warn(`[refresh:fc] ${c.home} v ${c.away}: no result extracted`);
      continue;
    }
    const changed = await applyResult(c, e);
    const tag = changed ? (DRY ? 'WOULD UPDATE' : 'updated') : 'skip (notstarted/partial)';
    console.log(`[refresh:fc] ${c.home} v ${c.away}: ${e.home_score ?? '-'}-${e.away_score ?? '-'} ${e.status} → ${tag}`);
    if (changed) updated++;
  }
  console.log(`[refresh:fc] ${DRY ? 'would update' : 'updated'} ${updated}/${cands.length} matches`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('[refresh:fc] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
