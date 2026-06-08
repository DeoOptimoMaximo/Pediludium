import { dbQuery } from './db.ts';
import type { DcFit, DcMatch } from './model.ts';

/**
 * Shared data loading + host-advantage logic for the Dixon-Coles predictor and the
 * Monte-Carlo simulator. Reads ONLY from our own DB (public.team_match) — no SofaScore.
 */

/** Host nations of WC2026 get a genuine home edge; everyone else plays ~neutral. */
export const HOSTS = new Set(['US', 'MX', 'CA']);

/**
 * Build the Dixon-Coles training set from stored history. team_match holds two rows per
 * event (one per tracked team's perspective); we reconstruct the absolute home/away
 * fixture and de-duplicate by event_id. ageDays is measured from `now` for time decay.
 */
export async function loadDcMatches(nowMs = Date.now()): Promise<DcMatch[]> {
  const rows = await dbQuery<{
    event_id: string;
    is_home: boolean | null;
    team_id: string;
    opponent_id: string | null;
    team_score: number | null;
    opponent_score: number | null;
    start_ts: string | null;
  }>(
    `select event_id, is_home, team_id, opponent_id, team_score, opponent_score, start_ts
       from public.team_match
      where team_score is not null and opponent_score is not null
        and opponent_id is not null`,
  );

  const byEvent = new Map<number, DcMatch>();
  for (const r of rows) {
    const eventId = Number(r.event_id);
    if (byEvent.has(eventId)) continue; // first perspective wins; both encode the same result
    const team = Number(r.team_id);
    const opp = Number(r.opponent_id);
    const ts = r.team_score ?? 0;
    const os = r.opponent_score ?? 0;
    const home = r.is_home ? team : opp;
    const away = r.is_home ? opp : team;
    const hs = r.is_home ? ts : os;
    const as = r.is_home ? os : ts;
    const startMs = r.start_ts ? new Date(r.start_ts).getTime() : nowMs;
    const ageDays = Math.max(0, (nowMs - startMs) / 86_400_000);
    byEvent.set(eventId, { home, away, hs, as, ageDays });
  }
  return [...byEvent.values()];
}

/** Team ids of the host nations (for the home-edge bump), resolved from country code. */
export async function loadHostTeamIds(): Promise<Set<number>> {
  const rows = await dbQuery<{ ss_id: string; country_alpha2: string | null }>(
    `select ss_id, country_alpha2 from public.team where is_national`,
  );
  const out = new Set<number>();
  for (const r of rows)
    if (r.country_alpha2 && HOSTS.has(r.country_alpha2)) out.add(Number(r.ss_id));
  return out;
}

/**
 * Effective log home-edge for a fixture. The fitted γ comes mostly from historical
 * home/away qualifiers; at a World Cup almost every venue is neutral, so we damp γ to a
 * token edge for the nominal home side — except host nations, who do play at home.
 */
export function homeEdge(fit: DcFit, hostPlaysHome: boolean): number {
  return hostPlaysHome ? fit.gamma + 0.1 : fit.gamma * 0.35;
}
