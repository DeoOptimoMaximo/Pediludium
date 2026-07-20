import { WORLD_CUP } from './config.ts';
import { dbQuery } from './db.ts';

/**
 * Operational plumbing shared by the sync gate, the Firecrawl refresher and the health check
 * (docs/21 §2). Two concerns live here:
 *
 *   1. HEARTBEATS — "when did stage X last succeed?". The launchd jobs exit 0 even when every
 *      step inside them fails, so a heartbeat is the only honest signal of liveness.
 *   2. CATCH-UP — which matches still need a result check, and how often. This replaces the old
 *      wall-clock window ([now-18h, now+15m]) that silently gave up on any match played while
 *      the DB was down: by the time Postgres came back the match was outside the window and was
 *      never looked at again (docs/21 §0 — the 2× R16 and 3× QF holes).
 */

/* ── heartbeats ─────────────────────────────────────────────────────────── */

export type HeartbeatKey = 'refresh:fc' | 'refresh' | 'snapshot' | 'health' | 'sync-gate';

export async function recordHeartbeat(
  key: HeartbeatKey,
  ok: boolean,
  detail?: Record<string, unknown>,
): Promise<void> {
  await dbQuery(
    `insert into public.ops_heartbeat (key, at, ok, detail)
     values ($1, now(), $2, $3)
     on conflict (key) do update set at = now(), ok = excluded.ok, detail = excluded.detail`,
    [key, ok, detail ? JSON.stringify(detail) : null],
  );
}

export interface Heartbeat {
  key: string;
  at: string;
  ok: boolean;
  age_h: number;
}

export async function loadHeartbeats(): Promise<Heartbeat[]> {
  const rows = await dbQuery<{ key: string; at: string; ok: boolean; age_h: string }>(
    `select key, at, ok, extract(epoch from (now() - at)) / 3600 as age_h
       from public.ops_heartbeat order by key`,
  );
  // pg returns numeric/interval extractions as strings — Number() them here, once, rather than
  // letting a string leak into arithmetic downstream (the bigint→string trap from the Elo bug).
  return rows.map((r) => ({ key: r.key, at: r.at, ok: r.ok, age_h: Number(r.age_h) }));
}

/* ── season freeze (docs/21 §3B) ────────────────────────────────────────── */

export interface SeasonProgress {
  played: number;
  total: number;
  /** every fixture we know about has a result → the competition is an archive */
  complete: boolean;
}

/**
 * Is this season finished for good?
 *
 * THE TRAP, and the reason this is a named function with its own tests rather than an
 * inline `played === total`: an empty season also satisfies played === total (0 === 0).
 * A newly onboarded competition, before its first ingest, would declare itself complete
 * and freeze the very jobs meant to fill it — a competition that can never start. The
 * `total > 0` clause is the whole point.
 *
 * Note this is deliberately about FIXTURES WE KNOW, not a hardcoded 104. The next
 * competition (docs/21 §4) has a different size, and hardcoding a count is exactly the
 * kind of WC-shaped constant that generalisation has to remove.
 */
export function isSeasonComplete(played: number, total: number): boolean {
  return total > 0 && played >= total;
}

/** Fixture counts for a season, and whether it has been played to the end. */
export async function loadSeasonProgress(
  seasonId: number = WORLD_CUP.seasonId2026,
): Promise<SeasonProgress> {
  const rows = await dbQuery<{ played: string; total: string }>(
    `select count(*) filter (where status_type = 'finished') as played,
            count(*) as total
       from public.match where season_id = $1`,
    [seasonId],
  );
  // node-pg returns count() as a string — Number() or the comparison silently lies
  const played = Number(rows[0]?.played ?? 0);
  const total = Number(rows[0]?.total ?? 0);
  return { played, total, complete: isSeasonComplete(played, total) };
}

/* ── catch-up window + per-match backoff ────────────────────────────────── */

/**
 * How stale a fixture may be and still be worth checking. Past this a match is "stranded":
 * something is structurally wrong (dead slug, cancelled fixture, a bracket slot that was never
 * resolved) and no number of scrapes will fix it — the health check alerts on it instead.
 */
export const STRANDED_AFTER_D = Number(process.env.SYNC_STRANDED_AFTER_D ?? 14);

/**
 * Escalating backoff, in minutes, after `attempts` consecutive unresolved checks.
 *
 * The ladder has to serve two very different regimes with one number. A match actually being
 * played wants the fastest cadence for as long as it runs: 90' + halftime + stoppage + possible
 * extra time and penalties, plus SofaScore's own lag before it flips to Finished, is comfortably
 * four hours — 16 ticks at 15 min. Only past that does "still not resolved" stop meaning "in
 * play" and start meaning "something is wrong", and the cost of being wrong flips: each check is
 * a Firecrawl credit, and a stranded match left on the fast cadence burns ~96 credits a day
 * forever. So the ladder stays free-running through a plausible match, then decays hard.
 */
export function backoffMinutes(attempts: number): number {
  if (attempts < 16) return 15; // ≈ first 4h — a match in play, checked every tick
  if (attempts < 32) return 60; // ≈ next 16h — overnight, still plausibly a lagging feed
  if (attempts < 56) return 360; // ≈ next 6 days — quietly persistent
  return 1440; // once a day until it ages out of the window entirely
}

export interface DueMatch {
  ss_id: number;
  slug: string | null;
  cid: string | null;
  home: string | null;
  away: string | null;
  status_type: string | null;
  start_ts: string;
  attempts: number;
}

/**
 * Matches whose result we still owe the site: kickoff is in the past (or imminent), our DB does
 * not have them as finished, they are not yet stranded, and their per-match backoff has expired.
 *
 * Note what is NOT here: any reference to "recent". Eligibility is a function of *match state*,
 * not of how long ago the clock says it kicked off, which is the whole point — a match played
 * during a nine-day outage is just as due the moment the database answers again.
 */
export async function loadDueMatches(seasonId: number = WORLD_CUP.seasonId2026): Promise<DueMatch[]> {
  const rows = await dbQuery<Omit<DueMatch, 'ss_id' | 'attempts'> & { ss_id: string; attempts: number }>(
    `select m.ss_id, m.raw->>'slug' as slug, m.raw->>'customId' as cid,
            coalesce(th.name, m.raw->'homeTeam'->>'name') as home,
            coalesce(ta.name, m.raw->'awayTeam'->>'name') as away,
            m.status_type, m.start_ts,
            coalesce(a.attempts, 0) as attempts
       from public.match m
       left join public.team th on th.ss_id = m.home_team_id
       left join public.team ta on ta.ss_id = m.away_team_id
       left join public.match_sync_attempt a on a.match_id = m.ss_id
      where m.season_id = $1
        and m.status_type is distinct from 'finished'
        and m.start_ts < now() + interval '15 minutes'
        and m.start_ts > now() - make_interval(days => $2)
        and (a.next_check_at is null or a.next_check_at <= now())
      order by m.start_ts`,
    [seasonId, STRANDED_AFTER_D],
  );
  return rows.map((r) => ({ ...r, ss_id: Number(r.ss_id), attempts: Number(r.attempts) }));
}

/**
 * Record the outcome of one check. `resolved` clears the row (the match is finished — it will
 * never be selected again anyway, but leaving stale counters around makes the table lie);
 * anything else advances the backoff ladder.
 *
 * `priorAttempts` comes from the DueMatch row the caller already loaded, which keeps the ladder
 * in exactly one place (backoffMinutes) instead of mirroring it as a SQL CASE that would quietly
 * drift out of sync with the TypeScript the tests exercise.
 */
export async function recordSyncAttempt(
  matchId: number,
  priorAttempts: number,
  outcome: { resolved: boolean; status?: string | null },
): Promise<void> {
  if (outcome.resolved) {
    await dbQuery(`delete from public.match_sync_attempt where match_id = $1`, [matchId]);
    return;
  }
  const attempts = priorAttempts + 1;
  await dbQuery(
    `insert into public.match_sync_attempt (match_id, attempts, last_attempt_at, last_status, next_check_at)
     values ($1, $2, now(), $3, now() + make_interval(mins => $4))
     on conflict (match_id) do update set
       attempts = excluded.attempts,
       last_attempt_at = excluded.last_attempt_at,
       last_status = excluded.last_status,
       next_check_at = excluded.next_check_at`,
    [matchId, attempts, outcome.status ?? null, backoffMinutes(attempts)],
  );
}
