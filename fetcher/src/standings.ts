import { WORLD_CUP } from './config.ts';
import { closeDb, dbQuery } from './db.ts';

/**
 * Recompute group standings from finished match results (`npm run standings`). DB-only,
 * zero SofaScore calls — so the group tables stay fresh even though the `/standings/total`
 * endpoint is challenge-blocked (docs/15). Group membership comes from the existing
 * `standing` rows (seeded by backfill); we only update played/W/D/L/GF/GA/points/position,
 * leaving membership and the original `raw` intact.
 *
 * Ranking = points → goal difference → goals for (the displayed group-stage order). Full
 * FIFA tie-breaks add head-to-head / fair-play, which only matter in rare ties and are left
 * to the official table when it is reachable again.
 */

const S = WORLD_CUP.seasonId2026;

interface Acc {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  points: number;
}

const blank = (): Acc => ({ played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, points: 0 });

async function main(): Promise<void> {
  const members = await dbQuery<{ group_name: string; team_id: string }>(
    `select group_name, team_id from public.standing
      where season_id = $1 and group_name is not null and team_id is not null`,
    [S],
  );
  const matches = await dbQuery<{
    group_name: string;
    home_team_id: string;
    away_team_id: string;
    home_score: number;
    away_score: number;
  }>(
    `select group_name, home_team_id, away_team_id, home_score, away_score
       from public.match
      where season_id = $1 and status_type = 'finished' and group_name is not null
        and home_team_id is not null and away_team_id is not null
        and home_score is not null and away_score is not null`,
    [S],
  );

  const key = (g: string, t: number): string => `${g}|${t}`;
  const acc = new Map<string, Acc>();
  for (const m of members) acc.set(key(m.group_name, Number(m.team_id)), blank()); // seed at 0

  for (const mt of matches) {
    const g = mt.group_name;
    const h = Number(mt.home_team_id);
    const a = Number(mt.away_team_id);
    const H = acc.get(key(g, h)) ?? acc.set(key(g, h), blank()).get(key(g, h))!;
    const A = acc.get(key(g, a)) ?? acc.set(key(g, a), blank()).get(key(g, a))!;
    H.played++;
    A.played++;
    H.gf += mt.home_score;
    H.ga += mt.away_score;
    A.gf += mt.away_score;
    A.ga += mt.home_score;
    if (mt.home_score > mt.away_score) {
      H.wins++;
      A.losses++;
      H.points += 3;
    } else if (mt.home_score < mt.away_score) {
      A.wins++;
      H.losses++;
      A.points += 3;
    } else {
      H.draws++;
      A.draws++;
      H.points++;
      A.points++;
    }
  }

  // rank within each group and write position + stats back
  const byGroup = new Map<string, { team: number; a: Acc }[]>();
  for (const [k, a] of acc) {
    const sep = k.indexOf('|');
    const g = k.slice(0, sep);
    const t = Number(k.slice(sep + 1));
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push({ team: t, a });
  }

  let written = 0;
  for (const [g, rows] of byGroup) {
    rows.sort(
      (x, y) =>
        y.a.points - x.a.points ||
        y.a.gf - y.a.ga - (x.a.gf - x.a.ga) ||
        y.a.gf - x.a.gf ||
        x.team - y.team,
    );
    let pos = 1;
    for (const r of rows) {
      await dbQuery(
        `update public.standing
            set position = $3, played = $4, wins = $5, draws = $6, losses = $7,
                goals_for = $8, goals_against = $9, points = $10, fetched_at = now()
          where season_id = $1 and group_name = $2 and team_id = $11`,
        [S, g, pos, r.a.played, r.a.wins, r.a.draws, r.a.losses, r.a.gf, r.a.ga, r.a.points, r.team],
      );
      pos++;
      written++;
    }
  }
  console.log(`[standings] recomputed ${written} rows across ${byGroup.size} groups from ${matches.length} finished matches`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((err) => {
      console.error('[standings] fatal:', err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closeDb();
    });
}
