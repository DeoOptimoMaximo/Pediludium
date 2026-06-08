import Link from 'next/link';
import { getRatings, getSimulations, getStandings } from '@/lib/data';
import { flag, pct } from '@/lib/format';
import type { StandingRow } from '@/lib/types';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

const THIRD = 'Third-placed teams';

type LeagueRow = {
  team_id: number | null;
  name: string;
  alpha2: string | null;
  grp: string;
  pos: number;
  pl: number; w: number; d: number; l: number;
  gf: number; ga: number; gd: number; pts: number;
  elo: number;
  adv: number | undefined;
};

export default async function GroupsPage() {
  const [rows, sims, ratings] = await Promise.all([getStandings(), getSimulations(), getRatings()]);
  const advOf = new Map<number, number>();
  for (const s of sims) advOf.set(s.team_id, s.p_advance ?? 0);
  const eloOf = new Map<number, number>();
  for (const r of ratings) eloOf.set(r.team_id, r.rating);
  const hasSim = sims.length > 0;

  // Group cards: real groups A–L only. SofaScore ships a 13th "Third-placed
  // teams" meta-table — we drop it here and recompute the cross-group third
  // ranking ourselves in the league ladder below.
  const groups = new Map<string, StandingRow[]>();
  for (const r of rows) {
    if (r.group_name === THIRD) continue;
    const k = r.group_name ?? 'Other';
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  // The whole group stage flattened into ONE cross-group league. Each finishing
  // position (1st…4th of every group) is a tier; within a tier teams are ranked
  // against each other. Pre-tournament every stat is 0, so the order falls back
  // to Elo (a stand-in for the FIFA-ranking seed) and then reshuffles live as
  // real results land — see who is in the qualification zone at a glance.
  const league: LeagueRow[] = [];
  for (const [name, rs] of groups) {
    if (name === 'Other') continue;
    const letter = name.replace(/^Group\s+/, '');
    for (const r of rs) {
      const gf = r.goals_for ?? 0;
      const ga = r.goals_against ?? 0;
      league.push({
        team_id: r.team_id,
        name: r.team?.name ?? r.team?.short_name ?? String(r.team_id),
        alpha2: r.team?.country_alpha2 ?? null,
        grp: letter,
        pos: r.position ?? 4,
        pl: r.played ?? 0, w: r.wins ?? 0, d: r.draws ?? 0, l: r.losses ?? 0,
        gf, ga, gd: gf - ga, pts: r.points ?? 0,
        elo: (r.team_id != null && eloOf.get(r.team_id)) || 0,
        adv: r.team_id != null ? advOf.get(r.team_id) : undefined,
      });
    }
  }
  // Official tiebreaker chain (points → GD → goals), with Elo as the pre-result
  // seed in place of the FIFA-ranking tiebreak.
  const byRank = (a: LeagueRow, b: LeagueRow) =>
    b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.elo - a.elo || a.name.localeCompare(b.name);
  const tier = (p: number) => league.filter((r) => r.pos === p).sort(byRank);
  const winners = tier(1);
  const runners = tier(2);
  const thirds = tier(3);
  const fourths = tier(4);
  const thirdsAdv = thirds.slice(0, 8); // best 8 of 12 advance
  const thirdsOut = thirds.slice(8); // bottom 4 are eliminated
  const ladderReady = league.length > 0;
  const cols = hasSim ? 12 : 11;

  const teamRow = (r: LeagueRow, rank: number, opts: { q?: boolean; out?: boolean } = {}) => (
    <tr
      key={`${r.pos}-${r.team_id}`}
      className={[opts.q ? 'qrow' : '', opts.out ? 'outrow' : ''].join(' ').trim() || undefined}
    >
      <td>{rank}</td>
      <td className="name">
        <Link href={`/team/${r.team_id}`} className="teamlink">
          <span className="flag">{flag(r.alpha2)}</span> {r.name}
        </Link>
      </td>
      <td className="muted">{r.grp}</td>
      <td>{r.pl}</td>
      <td>{r.w}</td>
      <td>{r.d}</td>
      <td>{r.l}</td>
      <td>{r.gf}</td>
      <td>{r.ga}</td>
      <td className="num">{r.gd > 0 ? `+${r.gd}` : r.gd}</td>
      <td className="pts">{r.pts}</td>
      {hasSim && (
        <td className="num" style={{ color: 'var(--accent)' }}>
          {r.adv != null ? `${pct(r.adv)}%` : '–'}
        </td>
      )}
    </tr>
  );

  const head = (label: string, tag: string, kind: 'adv' | 'out') => (
    <tr className={`tierhead ${kind}`}>
      <td colSpan={cols}>
        <div className="lbl">
          {label}
          <span className="tag">{tag}</span>
        </div>
      </td>
    </tr>
  );

  return (
    <>
      <RealtimeRefresh table="standing" />
      <h1 style={{ marginTop: 28 }}>Groups & standings</h1>
      <p className="muted">
        12 groups of 4. Tables update live once matches kick off (all zeros pre-tournament).
        {hasSim && (
          <>
            {' '}
            <b>Adv</b> = chance of reaching the Round of 32 from the{' '}
            <Link href="/simulation" className="teamlink">forecast</Link>.
          </>
        )}
      </p>

      <div className="grid cols-2">
        {[...groups.entries()].map(([name, rs]) => (
          <div className="card" key={name}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{name}</h2>
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th style={{ textAlign: 'left' }}>Team</th>
                  <th>P</th>
                  <th>W</th>
                  <th>D</th>
                  <th>L</th>
                  <th>GF</th>
                  <th>GA</th>
                  <th>Pts</th>
                  {hasSim && <th>Adv</th>}
                </tr>
              </thead>
              <tbody>
                {rs.map((r) => (
                  <tr key={`${name}-${r.team_id}`}>
                    <td>{r.position ?? '-'}</td>
                    <td className="name">
                      <Link href={`/team/${r.team_id}`} className="teamlink">
                        <span className="flag">{flag(r.team?.country_alpha2)}</span>{' '}
                        {r.team?.name ?? r.team?.short_name ?? r.team_id}
                      </Link>
                    </td>
                    <td>{r.played ?? 0}</td>
                    <td>{r.wins ?? 0}</td>
                    <td>{r.draws ?? 0}</td>
                    <td>{r.losses ?? 0}</td>
                    <td>{r.goals_for ?? 0}</td>
                    <td>{r.goals_against ?? 0}</td>
                    <td className="pts">{r.points ?? 0}</td>
                    {hasSim && (
                      <td className="num" style={{ color: 'var(--accent)' }}>
                        {r.team_id != null && advOf.has(r.team_id) ? `${pct(advOf.get(r.team_id))}%` : '–'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {ladderReady && (
        <div className="card" style={{ marginTop: 28 }}>
          <h2>Group stage as one league</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            All 48 teams in a single cross-group table, banded by finishing position and ranked by points · goal
            difference · goals (pre-tournament: Elo seed). The top two of every group plus the{' '}
            <b>8 best third-placed</b> teams — <b>32 in total</b> — cross the line into the Round of 32; the bottom 4
            thirds and all 12 fourth-placed teams are out.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th style={{ textAlign: 'left' }}>Team</th>
                <th>Grp</th>
                <th>P</th>
                <th>W</th>
                <th>D</th>
                <th>L</th>
                <th>GF</th>
                <th>GA</th>
                <th>GD</th>
                <th>Pts</th>
                {hasSim && <th>Adv</th>}
              </tr>
            </thead>
            <tbody>
              {head('Group winners', 'advance · 12', 'adv')}
              {winners.map((r, i) => teamRow(r, i + 1, { q: true }))}
              {head('Runners-up', 'advance · 12', 'adv')}
              {runners.map((r, i) => teamRow(r, i + 1, { q: true }))}
              {head('Third-placed — best 8', 'advance · 8', 'adv')}
              {thirdsAdv.map((r, i) => teamRow(r, i + 1, { q: true }))}
              <tr className="cutbar">
                <td colSpan={cols}>
                  <div className="bar">
                    <span className="ln" />
                    <span className="lbl2">Round of 32 cutoff — top 32 qualify</span>
                    <span className="ln r" />
                  </div>
                </td>
              </tr>
              {thirdsOut.map((r, i) => teamRow(r, i + 9, { out: true }))}
              {head('Fourth-placed', 'eliminated · 12', 'out')}
              {fourths.map((r, i) => teamRow(r, i + 1, { out: true }))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
