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
 * match page even when our egress is blocked. We scrape it as **markdown (1 credit)** and
 * parse the result deterministically — the rendered page reliably carries SofaScore's own
 * "Match ends, {home} N, {away} M." commentary plus "Finished"/"Full-time"/"FT N - M".
 * (The earlier LLM schema extraction, ~5 credits, was both pricier and unreliable: it
 * returned `notstarted` for a match the page clearly showed as Finished 2-0.) Scores/status
 * only — never touches fixtures/teams; only the handful of matches in play / recently ended.
 *
 * After this, re-run standings → predict:dc → predict:dcm → simulate → snapshot to publish.
 */

const S = WORLD_CUP.seasonId2026;
const MAX = Number(process.env.REFRESH_FC_MAX ?? 12);
const DRY = process.env.REFRESH_FC_DRY === '1';
// How far back to look for started-but-unfinished matches. The schedule-aware match-sync
// job sets this small (e.g. 4h) so it only checks matches actually in play / just ended;
// a manual catch-up run can widen it. Default 60h covers a multi-day backlog.
const SINCE_H = Number(process.env.REFRESH_FC_SINCE_H ?? 60);

interface Cand {
  ss_id: number;
  slug: string;
  cid: string;
  home: string | null;
  away: string | null;
  status_type: string | null;
  start_ts: string | null;
}

async function loadCandidates(): Promise<Cand[]> {
  // home/away come from the RESOLVED team_id joins — the same source the wc2026_match view
  // uses to render names — NOT raw.homeTeam/awayTeam. parseResultMarkdown verifies the score
  // orientation against these names, so the score is always attributed to the team we actually
  // display. A knockout tie whose home/away slot order differs from SofaScore's (resolve:ko
  // can't reliably read home/away from a rendered page — the URL slug order is inconsistent)
  // would otherwise get the winner inverted on the public scorecard. Fall back to raw names
  // for any slot not yet re-pointed to a national team.
  const rows = await dbQuery<Omit<Cand, 'ss_id'> & { ss_id: string }>(
    `select m.ss_id, m.raw->>'slug' as slug, m.raw->>'customId' as cid,
            coalesce(th.name, m.raw->'homeTeam'->>'name') as home,
            coalesce(ta.name, m.raw->'awayTeam'->>'name') as away,
            m.status_type, m.start_ts
       from public.match m
       left join public.team th on th.ss_id = m.home_team_id
       left join public.team ta on ta.ss_id = m.away_team_id
      where m.season_id = $1 and m.raw->>'slug' is not null and m.raw->>'customId' is not null
        and m.start_ts < now() + interval '30 minutes'
        and m.start_ts > now() - make_interval(hours => $2)
        and m.status_type is distinct from 'finished'
      order by m.start_ts`,
    [S, SINCE_H],
  );
  return rows.map((r) => ({ ...r, ss_id: Number(r.ss_id) }));
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse the scheduled kickoff from a match page's "… starting on 14 Jun 2026 at 17:00 UTC …"
 * line into an ISO timestamp. Exported for testing. Returns null if absent/unparseable.
 * Lets refresh:fc also CORRECT a drifted start_ts from the same scrape it already does — so a
 * rescheduled match isn't stranded outside the sync window (the schedule used to be refreshed
 * only via the dead mobile proxy). null on no match.
 */
export function parseKickoffUtc(md: string): string | null {
  if (!md) return null;
  const m = md.match(/starting on (\d{1,2}) ([A-Za-z]{3}) (\d{4}) at (\d{2}):(\d{2}) UTC/i);
  if (!m) return null;
  const day = Number(m[1]);
  const mon = MONTHS[m[2]!.toLowerCase()];
  const year = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  if (mon === undefined) return null;
  const t = Date.UTC(year, mon, day, hh, mm, 0);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export interface Extracted {
  home_score: number | null;
  away_score: number | null;
  status: 'notstarted' | 'inprogress' | 'finished';
}

/** Strip diacritics + lowercase for tolerant team-name comparison (Türkiye ↔ turkiye). */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Parse a SofaScore match page rendered to markdown into {home_score, away_score, status}.
 * Deterministic, exported for unit testing. Priorities (most → least reliable):
 *   1. "Match ends, {home} N, {away} M." — full-time commentary, names the teams explicitly.
 *   2. "FT N - M" together with a Finished/Full-time marker (home-away order).
 *   3. Live: a half/minute marker + "HT N - M" → inprogress with the halftime score.
 *   4. otherwise notstarted.
 * Returns null only if `md` is empty.
 */
export function parseResultMarkdown(
  md: string,
  homeName: string | null,
  awayName: string | null,
): Extracted | null {
  if (!md) return null;
  const text = md.replace(/\r/g, '');

  // 1) "Match ends, {team} N, {team} M." — SofaScore writes home first, but verify by name.
  const me = text.match(/Match ends,\s*(.+?)\s+(\d+),\s*(.+?)\s+(\d+)\s*\./i);
  if (me) {
    const t1 = me[1]!;
    let hs = Number(me[2]);
    let as = Number(me[4]);
    if (homeName && awayName && norm(t1).includes(norm(awayName)) && !norm(t1).includes(norm(homeName))) {
      hs = Number(me[4]);
      as = Number(me[2]);
    }
    return { home_score: hs, away_score: as, status: 'finished' };
  }

  const finished = /\b(Full-?time|Finished|After extra time|AET|Penalt)\b/i.test(text);

  // 2) "FT N - M" (full-time score, home-away). Must NOT match "HT N - M".
  const ft = text.match(/\bFT\s+(\d+)\s*[-–]\s*(\d+)/);
  if (ft && finished) {
    return { home_score: Number(ft[1]), away_score: Number(ft[2]), status: 'finished' };
  }

  // 3) in progress: a live match clock (45', 90+2') — anchored to the apostrophe-minute
  // token so it can't be tripped by SofaScore's footer boilerplate ("halftime and full
  // time soccer results …"), which would otherwise flag every not-started page as live.
  const live = /\b\d{1,3}(?:\+\d+)?['’]/.test(text);
  if (live) {
    const ht = text.match(/\bHT\s+(\d+)\s*[-–]\s*(\d+)/);
    if (ht) return { home_score: Number(ht[1]), away_score: Number(ht[2]), status: 'inprogress' };
    return { home_score: null, away_score: null, status: 'inprogress' };
  }

  // 4) not started (or nothing parseable yet)
  return { home_score: null, away_score: null, status: 'notstarted' };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Scrape a match page as markdown (1 credit); parse both the result and the kickoff time. */
function scrapeResult(
  url: string,
  home: string | null,
  away: string | null,
): { e: Extracted | null; kickoff: string | null } {
  const out = path.join(tmpdir(), `fcres-${Math.abs(hashCode(url))}.md`);
  // --max-age 0 forces a FRESH render every call. Firecrawl caches scrapes by default, and a
  // live match scraped once near kickoff would otherwise keep returning that stale "notstarted"
  // preview for hours — the match would fall out of the sync window before its real score ever
  // landed (root cause of finished games stuck as "scheduled" on the public scorecard).
  const res = spawnSync(
    'firecrawl',
    ['scrape', url, '--format', 'markdown', '--country', 'HR', '--max-age', '0', '--wait-for', '8000', '-o', out],
    { encoding: 'utf8', timeout: 90_000 },
  );
  if (res.status !== 0) {
    console.warn(`[refresh:fc] scrape failed (${res.status}): ${String(res.stderr).slice(0, 120)}`);
    return { e: null, kickoff: null };
  }
  try {
    const md = spawnSync('cat', [out], { encoding: 'utf8' }).stdout ?? res.stdout ?? '';
    return { e: parseResultMarkdown(md, home, away), kickoff: parseKickoffUtc(md) };
  } catch (e) {
    console.warn(`[refresh:fc] parse failed: ${String(e).slice(0, 100)}`);
    return { e: null, kickoff: null };
  } finally {
    void rm(out, { force: true });
  }
}

/**
 * Correct a drifted kickoff. Only for matches not yet finished, only when the parsed time
 * differs from our stored start_ts, and only within a sane horizon ([now-2d, now+90d]) so a
 * stray date on the page can't fling a fixture across the calendar. Updates start_ts only.
 * Returns the new ISO time if it changed, else null.
 */
async function applyKickoff(c: Cand, kickoffIso: string | null): Promise<string | null> {
  if (!kickoffIso) return null;
  const cur = c.start_ts ? new Date(c.start_ts).toISOString() : null;
  if (cur === kickoffIso) return null;
  const t = new Date(kickoffIso).getTime();
  const now = Date.now();
  if (t < now - 2 * 864e5 || t > now + 90 * 864e5) return null; // implausible → ignore
  if (DRY) return kickoffIso;
  await dbQuery(
    `update public.match set start_ts = $2, fetched_at = now()
      where ss_id = $1 and status_type <> 'finished'`,
    [c.ss_id, kickoffIso],
  );
  return kickoffIso;
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
  let rescheduled = 0;
  for (const c of cands) {
    const url = `https://www.sofascore.com/football/match/${c.slug}/${c.cid}`;
    const { e, kickoff } = scrapeResult(url, c.home, c.away);
    if (!e) {
      console.warn(`[refresh:fc] ${c.home} v ${c.away}: no result extracted`);
      continue;
    }
    const changed = await applyResult(c, e);
    const tag = changed ? (DRY ? 'WOULD UPDATE' : 'updated') : 'skip (notstarted/partial)';
    console.log(`[refresh:fc] ${c.home} v ${c.away}: ${e.home_score ?? '-'}-${e.away_score ?? '-'} ${e.status} → ${tag}`);
    if (changed) updated++;
    // Correct a drifted kickoff from the same scrape (free) — only while not finished.
    if (e.status !== 'finished') {
      const moved = await applyKickoff(c, kickoff);
      if (moved) {
        console.log(`[refresh:fc] ${c.home} v ${c.away}: kickoff ${c.start_ts ?? '?'} → ${moved}${DRY ? ' (DRY)' : ''}`);
        rescheduled++;
      }
    }
  }
  console.log(
    `[refresh:fc] ${DRY ? 'would update' : 'updated'} ${updated}/${cands.length} matches` +
      (rescheduled ? `, ${rescheduled} kickoff${rescheduled > 1 ? 's' : ''} corrected` : ''),
  );
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
