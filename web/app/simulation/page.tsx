import Link from 'next/link';
import { getSimulations, getStandings } from '@/lib/data';
import { flag } from '@/lib/format';
import { ProbBar } from '../components/ProbBar';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function SimulationPage() {
  const [sims, standings] = await Promise.all([getSimulations(), getStandings()]);

  // team_id → group letter (for the Grp column)
  const groupOf = new Map<number, string>();
  for (const s of standings) {
    if (s.team_id != null && s.group_name?.startsWith('Group ')) {
      groupOf.set(s.team_id, s.group_name.replace('Group ', ''));
    }
  }

  const iterations = sims[0]?.iterations ?? 0;
  const maxWin = Math.max(0.0001, ...sims.map((s) => s.p_win_cup ?? 0));

  return (
    <>
      <RealtimeRefresh table="tournament_simulation" />
      <h1 style={{ marginTop: 28 }}>Tournament forecast</h1>
      <p className="muted">
        <b>Dixon-Coles + Monte-Carlo</b> · {iterations.toLocaleString('en-GB')} simulated tournaments ·
        group-advance &amp; title odds
      </p>

      <div className="card" style={{ padding: '6px 14px' }}>
        <table className="tbl simtbl">
          <thead>
            <tr>
              <th>#</th>
              <th style={{ textAlign: 'left' }}>Team</th>
              <th>Grp</th>
              <th>Win grp</th>
              <th style={{ minWidth: 120 }}>Advance</th>
              <th>Semis</th>
              <th style={{ minWidth: 130 }}>Win cup</th>
            </tr>
          </thead>
          <tbody>
            {sims.map((s, i) => (
              <tr key={s.team_id}>
                <td className="muted">{i + 1}</td>
                <td className="name">
                  <Link href={`/team/${s.team_id}`} className="teamlink">
                    <span className="flag">{flag(s.team?.country_alpha2)}</span>{' '}
                    {s.team?.name ?? s.team?.short_name ?? s.team_id}
                  </Link>
                </td>
                <td>
                  <span className="chip group">{groupOf.get(s.team_id) ?? '–'}</span>
                </td>
                <td className="num">{Math.round((s.p_win_group ?? 0) * 100)}%</td>
                <td>
                  <ProbBar value={s.p_advance} tone="home" />
                </td>
                <td className="num">{Math.round((s.p_sf ?? 0) * 100)}%</td>
                <td>
                  <ProbBar value={s.p_win_cup} max={maxWin} tone="accent" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 18 }}>
        Each tournament is played out {iterations.toLocaleString('en-GB')} times: 72 group matches are
        sampled from the Dixon-Coles goal model, ranked with FIFA tie-breakers, the eight best
        third-placed teams qualify, and the full 32-team bracket is reconstructed from the official
        fixture slots (<code>1A</code>, <code>2C</code>, <code>3B/3E/…</code>, <code>W83</code>) and
        played to the final. <b>Win cup</b> bars are scaled to the leader. Group-stage odds are exact
        for the format; the knockout wiring follows the documented modelling assumptions in{' '}
        <code>docs/13-simulation-model.md</code>.
      </div>
    </>
  );
}
