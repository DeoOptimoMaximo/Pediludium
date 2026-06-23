import { WORLD_CUP } from './config.ts';
import { closeDb, dbQuery, upsertSimulation } from './db.ts';
import { loadDcMatches, loadHostTeamIds } from './dc-data.ts';
import {
  buildCdf,
  dcScoreMatrix,
  fitDixonColes,
  mulberry32,
  sampleScore,
  type DcFit,
} from './model.ts';

/**
 * Monte-Carlo tournament simulation (docs/08 #5, docs/13) — model_version = mc-sim-v1.
 *
 * Fits the Dixon-Coles model from our stored history, then plays the whole World Cup N
 * times: 72 group matches → group tables (FIFA tie-breakers) → 8 best third-placed teams
 * → the full 32-team knockout bracket, all reconstructed from the fixture placeholders
 * (1A / 2C / 3B-3E-3F-3I-3J / W83 / L101 …). Aggregates per-team probabilities of winning
 * the group, advancing, and reaching each knockout round incl. lifting the cup.
 *
 * Pure compute from our DB — zero SofaScore calls. Group-stage probabilities are exact for
 * the format; knockout wiring assumes FIFA's chronological match numbering within each
 * round (the only anchor in the data) and assigns best-thirds to slots by a valid
 * eligibility-respecting matching — see docs/13 for the modelling assumptions.
 */

const MODEL_VERSION = 'mc-sim-v1';
const ITERS = Number(process.env.SIM_ITERS ?? '20000');
const SEED = Number(process.env.SIM_SEED ?? '20260611');
const GROUP_HOME_DAMP = 0.35; // neutral-venue damping of fitted home edge for group games
const KO_HOME_DAMP = 0.2; // token edge for the nominal home slot in knockout
const HOST_BUMP = 0.1; // extra log-edge for a host nation, wherever it plays

/* ── bracket model ─────────────────────────────────────────────────────── */
type Ref =
  | { kind: 'pos'; group: string; pos: 0 | 1 } // group winner (0) / runner-up (1)
  | { kind: 'third'; slotId: string; groups: string[] } // best-third from one of `groups`
  | { kind: 'win'; num: number } // winner of match number n
  | { kind: 'lose'; num: number } // loser of match number n
  | { kind: 'team'; id: number }; // already-resolved team (real result filled the slot)

interface KoMatch {
  num: number;
  roundKey: 'r32' | 'r16' | 'qf' | 'sf' | 'final' | 'third';
  home: Ref;
  away: Ref;
}

function parseRef(
  name: string,
  matchNum: number,
  side: 'home' | 'away',
  nameToId: Map<string, number>,
): Ref {
  const s = (name ?? '').trim().toUpperCase();
  let m: RegExpExecArray | null;
  if ((m = /^W(\d+)$/.exec(s))) return { kind: 'win', num: Number(m[1]) };
  if ((m = /^L(\d+)$/.exec(s))) return { kind: 'lose', num: Number(m[1]) };
  if (s.includes('/') || /^3[A-L]/.test(s)) {
    const groups = s
      .split('/')
      .map((p) => p.replace(/[^A-L]/g, ''))
      .filter(Boolean);
    return { kind: 'third', slotId: `${matchNum}:${side}`, groups };
  }
  if ((m = /^([12])([A-L])$/.exec(s)))
    return { kind: 'pos', group: m[2]!, pos: m[1] === '1' ? 0 : 1 };
  if ((m = /^([A-L])([12])$/.exec(s)))
    return { kind: 'pos', group: m[1]!, pos: m[2] === '1' ? 0 : 1 };
  // group stage finished: the slot now carries the real qualifier's name — pin it
  const id = nameToId.get(s);
  if (id != null) return { kind: 'team', id };
  throw new Error(`unparseable knockout slot "${name}" (match ${matchNum})`);
}

const ROUND_KEY: Record<number, KoMatch['roundKey']> = {
  6: 'r32',
  5: 'r16',
  27: 'qf',
  28: 'sf',
  29: 'final',
  50: 'third',
};
// FIFA match-number ranges per knockout round (group games are 1-72)
const ROUND_NUM_START: Record<KoMatch['roundKey'], number> = {
  r32: 73,
  r16: 89,
  qf: 97,
  sf: 101,
  final: 103,
  third: 104,
};

interface Group {
  letter: string;
  teams: number[];
}
interface Fixture {
  home: number;
  away: number;
  group: string;
}

/** Assign each best-third slot a qualifying group via eligibility-respecting matching (Kuhn). */
function assignThirds(
  slots: { slotId: string; groups: string[] }[],
  qualifiedGroups: string[],
): Map<string, string> {
  const gIdx = new Map(qualifiedGroups.map((g, i) => [g, i]));
  const adj = slots.map((s) =>
    s.groups.map((g) => gIdx.get(g)).filter((i): i is number => i != null),
  );
  const groupTaken = new Array<number>(qualifiedGroups.length).fill(-1); // group -> slot
  const tryKuhn = (slot: number, seen: boolean[]): boolean => {
    for (const g of adj[slot] ?? []) {
      if (seen[g]) continue;
      seen[g] = true;
      const taken = groupTaken[g]!;
      if (taken === -1 || tryKuhn(taken, seen)) {
        groupTaken[g] = slot;
        return true;
      }
    }
    return false;
  };
  for (let s = 0; s < slots.length; s++) tryKuhn(s, new Array(qualifiedGroups.length).fill(false));

  const slotToGroup = new Map<string, string>();
  const usedGroup = new Set<string>();
  for (let g = 0; g < qualifiedGroups.length; g++) {
    const slot = groupTaken[g]!;
    if (slot !== -1) {
      slotToGroup.set(slots[slot]!.slotId, qualifiedGroups[g]!);
      usedGroup.add(qualifiedGroups[g]!);
    }
  }
  // fallback for any unmatched slot (Hall violation shouldn't happen with FIFA's lists)
  const freeGroups = qualifiedGroups.filter((g) => !usedGroup.has(g));
  for (const s of slots) {
    if (!slotToGroup.has(s.slotId) && freeGroups.length)
      slotToGroup.set(s.slotId, freeGroups.pop()!);
  }
  return slotToGroup;
}

async function main(): Promise<void> {
  const S = WORLD_CUP.seasonId2026;
  console.log(
    `\n=== Pediludium tournament simulation (${MODEL_VERSION}) — ${ITERS} iterations ===\n`,
  );

  // 1) fit Dixon-Coles (same model the predictor uses)
  const now = Date.now();
  const fit = fitDixonColes(await loadDcMatches(now), { halfLifeDays: 540, iterations: 250 });
  const hostIds = await loadHostTeamIds();
  console.log(
    `[sim] DC fitted: ${fit.teams.length} teams, γ=${fit.gamma.toFixed(3)}, ρ=${fit.rho.toFixed(3)}`,
  );

  // 2) groups (4 teams each) and the 72 group fixtures
  const standingRows = await dbQuery<{ group_name: string; team_id: string }>(
    `select group_name, team_id from public.standing
      where season_id = $1 and group_name like 'Group %' and team_id is not null
      order by group_name`,
    [S],
  );
  const groups = new Map<string, Group>();
  const teamNames = new Map<number, string>();
  for (const r of standingRows) {
    const letter = r.group_name.replace('Group ', '').trim();
    const g = groups.get(letter) ?? { letter, teams: [] };
    g.teams.push(Number(r.team_id));
    groups.set(letter, g);
  }
  const groupFixtures = await dbQuery<{
    home_team_id: string;
    away_team_id: string;
    group_name: string;
  }>(
    `select home_team_id, away_team_id, group_name from public.match
      where season_id = $1 and group_name is not null
        and home_team_id is not null and away_team_id is not null`,
    [S],
  );
  const fixtures: Fixture[] = groupFixtures.map((f) => ({
    home: Number(f.home_team_id),
    away: Number(f.away_team_id),
    group: f.group_name.replace('Group ', '').trim(),
  }));
  const nameToId = new Map<string, number>();
  for (const t of await dbQuery<{ ss_id: string; name: string }>(
    `select ss_id, name from public.team where is_national`,
  )) {
    teamNames.set(Number(t.ss_id), t.name);
    nameToId.set(t.name.trim().toUpperCase(), Number(t.ss_id));
  }

  // 3) reconstruct the knockout bracket from fixture placeholders
  const koRows = await dbQuery<{
    ss_id: string;
    round: number;
    start_ts: string;
    h: string;
    a: string;
  }>(
    `select ss_id, round, start_ts, raw->'homeTeam'->>'name' as h, raw->'awayTeam'->>'name' as a
       from public.match where season_id = $1 and round >= 5 order by round, start_ts`,
    [S],
  );
  // number matches within each round chronologically (FIFA convention; only anchor available)
  const counters: Record<string, number> = {};
  const ssToNum = new Map<number, number>();
  for (const r of koRows) {
    const key = ROUND_KEY[r.round];
    if (!key) continue;
    const c = counters[key] ?? 0;
    ssToNum.set(Number(r.ss_id), ROUND_NUM_START[key] + c);
    counters[key] = c + 1;
  }
  const ko: KoMatch[] = koRows.map((r) => {
    const num = ssToNum.get(Number(r.ss_id))!;
    return {
      num,
      roundKey: ROUND_KEY[r.round]!,
      home: parseRef(r.h, num, 'home', nameToId),
      away: parseRef(r.a, num, 'away', nameToId),
    };
  });
  ko.sort((x, y) => x.num - y.num);
  const thirdSlots = ko
    .flatMap((m) => [m.home, m.away])
    .filter((r): r is Extract<Ref, { kind: 'third' }> => r.kind === 'third')
    .map((r) => ({ slotId: r.slotId, groups: r.groups }));
  console.log(
    `[sim] bracket: ${ko.length} knockout matches, ${thirdSlots.length} best-third slots, ${groups.size} groups`,
  );

  // precompute group fixture scoreline CDFs once (λ,μ fixed per fixture)
  const goalRates = (home: number, away: number, baseEdge: number) => {
    const ah = fit.attack.get(home) ?? 0;
    const aa = fit.attack.get(away) ?? 0;
    const dh = fit.defense.get(home) ?? 0;
    const da = fit.defense.get(away) ?? 0;
    const hb = hostIds.has(home) ? HOST_BUMP : 0;
    const ab = hostIds.has(away) ? HOST_BUMP : 0;
    return { lambda: Math.exp(ah - da + baseEdge + hb), mu: Math.exp(aa - dh + ab) };
  };
  const groupCdf = fixtures.map((f) => {
    const base = hostIds.has(f.home) ? fit.gamma : fit.gamma * GROUP_HOME_DAMP;
    const { lambda, mu } = goalRates(f.home, f.away, base);
    return buildCdf(dcScoreMatrix(lambda, mu, fit.rho));
  });

  // 4) Monte-Carlo
  const rng = mulberry32(SEED);
  interface Tally {
    points: number;
    winGroup: number;
    runnerUp: number;
    third: number;
    advance: number;
    r16: number;
    qf: number;
    sf: number;
    final: number;
    champ: number;
  }
  const tally = new Map<number, Tally>();
  const blank = (): Tally => ({
    points: 0,
    winGroup: 0,
    runnerUp: 0,
    third: 0,
    advance: 0,
    r16: 0,
    qf: 0,
    sf: 0,
    final: 0,
    champ: 0,
  });
  for (const g of groups.values()) for (const t of g.teams) tally.set(t, blank());
  const bump = (team: number, k: keyof Tally, v = 1) => {
    const t = tally.get(team);
    if (t) t[k] += v;
  };

  interface Standing {
    team: number;
    pts: number;
    gd: number;
    gf: number;
    tb: number;
  }
  const cmp = (a: Standing, b: Standing) =>
    b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.tb - a.tb;

  for (let iter = 0; iter < ITERS; iter++) {
    // --- group stage ---
    const table = new Map<number, Standing>();
    for (const g of groups.values())
      for (const t of g.teams) table.set(t, { team: t, pts: 0, gd: 0, gf: 0, tb: rng() });
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i]!;
      const [hs, as] = sampleScore(groupCdf[i]!, rng);
      const H = table.get(f.home)!;
      const A = table.get(f.away)!;
      H.gf += hs;
      H.gd += hs - as;
      A.gf += as;
      A.gd += as - hs;
      if (hs > as) H.pts += 3;
      else if (hs < as) A.pts += 3;
      else {
        H.pts += 1;
        A.pts += 1;
      }
    }
    // rank each group; collect thirds
    const groupResult = new Map<string, number[]>(); // letter -> [1st,2nd,3rd,4th] team ids
    const thirds: Standing[] = [];
    for (const g of groups.values()) {
      const ranked = g.teams.map((t) => table.get(t)!).sort(cmp);
      const [first, second, third] = ranked as [Standing, Standing, Standing, Standing];
      groupResult.set(
        g.letter,
        ranked.map((r) => r.team),
      );
      bump(first.team, 'winGroup');
      bump(second.team, 'runnerUp');
      bump(third.team, 'third');
      for (const r of ranked) bump(r.team, 'points', r.pts);
      thirds.push({ ...third });
    }
    // best 8 third-placed teams qualify
    thirds.sort(cmp);
    const qualifiedThirds = thirds.slice(0, 8);
    const qualifiedGroups = qualifiedThirds
      .map((s) => {
        // which group does this third belong to?
        for (const [letter, ids] of groupResult) if (ids[2] === s.team) return letter;
        return '';
      })
      .filter(Boolean);
    const slotToGroup = assignThirds(thirdSlots, qualifiedGroups);

    // top-2 always advance; qualifying thirds advance
    for (const g of groups.values()) {
      const ids = groupResult.get(g.letter)!;
      bump(ids[0]!, 'advance');
      bump(ids[1]!, 'advance');
    }
    for (const s of qualifiedThirds) bump(s.team, 'advance');

    // --- knockout ---
    const resolve = (r: Ref, winner: Map<number, number>, loser: Map<number, number>): number => {
      switch (r.kind) {
        case 'pos':
          return groupResult.get(r.group)![r.pos]!;
        case 'third': {
          const grp = slotToGroup.get(r.slotId);
          return grp ? groupResult.get(grp)![2]! : qualifiedThirds[0]!.team; // fallback
        }
        case 'win':
          return winner.get(r.num)!;
        case 'lose':
          return loser.get(r.num)!;
        case 'team':
          return r.id;
      }
    };
    const winner = new Map<number, number>();
    const loser = new Map<number, number>();
    const reachKey: Record<KoMatch['roundKey'], keyof Tally | null> = {
      r32: null,
      r16: 'r16',
      qf: 'qf',
      sf: 'sf',
      final: 'final',
      third: null,
    };
    for (const m of ko) {
      const h = resolve(m.home, winner, loser);
      const a = resolve(m.away, winner, loser);
      const rk = reachKey[m.roundKey];
      if (rk) {
        bump(h, rk);
        bump(a, rk);
      }
      // play (neutral venue): sample DC; settle a draw by a coin (penalties)
      const { lambda, mu } = goalRates(h, a, fit.gamma * KO_HOME_DAMP);
      let [hs, as] = sampleScore(buildCdf(dcScoreMatrix(lambda, mu, fit.rho)), rng);
      let homeWins: boolean;
      if (hs > as) homeWins = true;
      else if (hs < as) homeWins = false;
      else homeWins = rng() < 0.5;
      winner.set(m.num, homeWins ? h : a);
      loser.set(m.num, homeWins ? a : h);
      if (m.roundKey === 'final') bump(homeWins ? h : a, 'champ');
    }
  }

  // 5) write per-team probabilities
  const teams = [...tally.keys()];
  for (const t of teams) {
    const c = tally.get(t)!;
    await upsertSimulation({
      season_id: S,
      team_id: t,
      model_version: MODEL_VERSION,
      iterations: ITERS,
      exp_group_points: c.points / ITERS,
      p_win_group: c.winGroup / ITERS,
      p_runner_up: c.runnerUp / ITERS,
      p_third: c.third / ITERS,
      p_advance: c.advance / ITERS,
      p_r16: c.r16 / ITERS,
      p_qf: c.qf / ITERS,
      p_sf: c.sf / ITERS,
      p_final: c.final / ITERS,
      p_win_cup: c.champ / ITERS,
    });
  }

  // log a leaderboard so the run is self-checking
  const board = teams
    .map((t) => ({
      name: teamNames.get(t) ?? String(t),
      win: tally.get(t)!.champ / ITERS,
      adv: tally.get(t)!.advance / ITERS,
    }))
    .sort((a, b) => b.win - a.win)
    .slice(0, 12);
  console.log(`\n[sim] top title chances:`);
  for (const r of board)
    console.log(
      `  ${r.name.padEnd(22)} win ${(r.win * 100).toFixed(1)}%   advance ${(r.adv * 100).toFixed(0)}%`,
    );
  console.log(`\n=== Simulation written: ${teams.length} teams (model ${MODEL_VERSION}) ===\n`);
}

main()
  .catch((err) => {
    console.error('[sim] fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
