import Link from 'next/link';
import { getSimulations, getStandings } from '@/lib/data';
import { flag, pct } from '@/lib/format';
import type { StandingRow } from '@/lib/types';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function GroupsPage() {
  const [rows, sims] = await Promise.all([getStandings(), getSimulations()]);
  const advOf = new Map<number, number>();
  for (const s of sims) advOf.set(s.team_id, s.p_advance ?? 0);
  const hasSim = sims.length > 0;

  const groups = new Map<string, StandingRow[]>();
  for (const r of rows) {
    const k = r.group_name ?? 'Other';
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

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
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {name}
            </h2>
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
    </>
  );
}
