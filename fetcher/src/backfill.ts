import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, WORLD_CUP } from './config.ts';
import { closeBrowser, getJson } from './browser.ts';
import { EventsResponseSchema, StandingsResponseSchema } from './schemas.ts';
import {
  closeDb,
  dbQuery,
  setMatchGroup,
  upsertMatch,
  upsertSeason,
  upsertStanding,
  upsertTeam,
  upsertTournament,
  type MatchRow,
  type TeamRow,
} from './db.ts';

/**
 * Day-2 backfill (docs/05): load the full WC2026 schedule + 48 teams + group standings
 * into Supabase. Real Chrome transport, politeness queue, raw dumped to files + upserted.
 * Generic schema; WC2026 applied as scope (tournament 16 / season 58210).
 */

const T = WORLD_CUP.uniqueTournamentId; // 16
const S = WORLD_CUP.seasonId2026; // 58210

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

async function saveSample(name: string, payload: unknown): Promise<void> {
  await mkdir(config.sampleDir, { recursive: true });
  await writeFile(join(config.sampleDir, `${name}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

function teamRowOf(t: AnyObj): TeamRow {
  return {
    ss_id: t.id,
    slug: t.slug ?? null,
    name: t.name ?? null,
    short_name: t.shortName ?? null,
    country_alpha2: t.country?.alpha2 ?? null,
    is_national: t.national ?? false,
    raw: t,
  };
}

function matchRowOf(e: AnyObj): MatchRow {
  return {
    ss_id: e.id,
    tournament_id: T,
    season_id: S,
    home_team_id: e.homeTeam?.id ?? null,
    away_team_id: e.awayTeam?.id ?? null,
    start_ts: e.startTimestamp ? new Date(e.startTimestamp * 1000).toISOString() : null,
    status_type: e.status?.type ?? null,
    status_code: e.status?.code ?? null,
    winner_code: e.winnerCode ?? null,
    home_score: e.homeScore?.current ?? e.homeScore?.display ?? null,
    away_score: e.awayScore?.current ?? e.awayScore?.display ?? null,
    home_score_ht: e.homeScore?.period1 ?? null,
    away_score_ht: e.awayScore?.period1 ?? null,
    round: e.roundInfo?.round ?? null,
    round_name: e.roundInfo?.name ?? null,
    group_name: null,
    raw: e,
  };
}

async function main(): Promise<void> {
  console.log(`\n=== Pediludium backfill — WC tournament ${T} / season ${S} ===\n`);

  // 1) Reference rows (FK parents) -----------------------------------------
  await upsertTournament({
    ss_id: T,
    slug: WORLD_CUP.slug,
    name: 'FIFA World Cup',
    category_id: WORLD_CUP.categoryId,
    category_slug: 'world',
  });
  await upsertSeason({ ss_id: S, tournament_id: T, year: '2026', name: 'World Cup 2026' });

  // 2) Full schedule: paginate events/next until hasNextPage=false ----------
  const teamIds = new Set<number>();
  let matchCount = 0;
  for (let page = 0; page < 40; page++) {
    const { data, raw } = await getJson(
      `/unique-tournament/${T}/season/${S}/events/next/${page}`,
      EventsResponseSchema,
    );
    await saveSample(`backfill-next-${page}`, raw);
    const events = (raw as AnyObj).events as AnyObj[];
    for (const e of events) {
      if (e.homeTeam) {
        await upsertTeam(teamRowOf(e.homeTeam));
        teamIds.add(e.homeTeam.id);
      }
      if (e.awayTeam) {
        await upsertTeam(teamRowOf(e.awayTeam));
        teamIds.add(e.awayTeam.id);
      }
      await upsertMatch(matchRowOf(e));
      matchCount++;
    }
    console.log(`[backfill] next/${page}: ${events.length} matches (running total ${matchCount})`);
    if (!data.hasNextPage) break;
  }

  // 2b) Also pull finished events (events/last) if any exist yet ------------
  for (let page = 0; page < 40; page++) {
    try {
      const { data, raw } = await getJson(
        `/unique-tournament/${T}/season/${S}/events/last/${page}`,
        EventsResponseSchema,
      );
      await saveSample(`backfill-last-${page}`, raw);
      const events = (raw as AnyObj).events as AnyObj[];
      for (const e of events) {
        if (e.homeTeam) await upsertTeam(teamRowOf(e.homeTeam));
        if (e.awayTeam) await upsertTeam(teamRowOf(e.awayTeam));
        await upsertMatch(matchRowOf(e));
        matchCount++;
      }
      console.log(`[backfill] last/${page}: ${events.length} finished matches`);
      if (!data.hasNextPage) break;
    } catch (err) {
      console.log(`[backfill] last/${page}: none yet (${String(err).slice(0, 60)})`);
      break;
    }
  }

  // 3) Standings (group tables) + tag matches with their group -------------
  const teamGroup = new Map<number, string>();
  try {
    const { data, raw } = await getJson(
      `/unique-tournament/${T}/season/${S}/standings/total`,
      StandingsResponseSchema,
    );
    await saveSample('backfill-standings', raw);
    const groups = (raw as AnyObj).standings as AnyObj[];
    let standingRows = 0;
    for (const g of groups) {
      const groupName: string = g.name ?? 'Group';
      for (const row of g.rows as AnyObj[]) {
        const teamId: number | undefined = row.team?.id;
        // only real groups (A–L) drive match tagging; skip pseudo-groups like "Third-placed teams"
        if (teamId && /^Group\b/i.test(groupName)) teamGroup.set(teamId, groupName);
        await upsertStanding({
          season_id: S,
          group_name: groupName,
          team_id: teamId ?? null,
          position: row.position ?? null,
          played: row.matches ?? null,
          wins: row.wins ?? null,
          draws: row.draws ?? null,
          losses: row.losses ?? null,
          goals_for: row.scoresFor ?? null,
          goals_against: row.scoresAgainst ?? null,
          points: row.points ?? null,
          raw: row,
        });
        standingRows++;
      }
    }
    console.log(`[backfill] standings: ${data.standings.length} groups, ${standingRows} rows`);

    // tag each group-stage match with its group (home team's group)
    let tagged = 0;
    const rows = await dbQuery<{ ss_id: number; home_team_id: number }>(
      'select ss_id, home_team_id from public.match where season_id=$1',
      [S],
    );
    for (const r of rows) {
      // pg returns bigint columns as strings → coerce before the numeric-keyed lookup
      const grp = teamGroup.get(Number(r.home_team_id));
      if (grp) {
        await setMatchGroup(r.ss_id, grp);
        tagged++;
      }
    }
    console.log(`[backfill] tagged ${tagged} matches with group`);
  } catch (err) {
    console.warn('[backfill] standings failed:', String(err).slice(0, 120));
  }

  console.log(`\n=== Backfill done: ${matchCount} matches, ${teamIds.size} teams ===\n`);
}

main()
  .catch((err) => {
    console.error('[backfill] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser();
    await closeDb();
  });
