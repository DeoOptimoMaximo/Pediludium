import Link from 'next/link';
import { getSimulations, getStandings } from '@/lib/data';
import { flag } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import { ProbBar } from '../components/ProbBar';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function SimulationPage() {
  const [{ lang, t }, sims, standings] = await Promise.all([getDict(), getSimulations(), getStandings()]);

  // team_id → group letter (for the Grp column)
  const groupOf = new Map<number, string>();
  for (const s of standings) {
    if (s.team_id != null && s.group_name?.startsWith('Group ')) {
      groupOf.set(s.team_id, s.group_name.replace('Group ', ''));
    }
  }

  const iterations = sims[0]?.iterations ?? 0;
  const iters = iterations.toLocaleString(lang === 'hr' ? 'hr-HR' : 'en-GB');
  const maxWin = Math.max(0.0001, ...sims.map((s) => s.p_win_cup ?? 0));

  return (
    <>
      <RealtimeRefresh table="tournament_simulation" />
      <h1 style={{ marginTop: 28 }}>{t.simulation.title}</h1>
      <p className="muted">
        <b>Dixon-Coles + Monte-Carlo</b> · {t.simulation.sub(iters)}
      </p>

      <div className="card" style={{ padding: '6px 14px' }}>
        <div className="tblwrap">
        <table className="tbl simtbl">
          <thead>
            <tr>
              <th>#</th>
              <th style={{ textAlign: 'left' }}>{t.simulation.th.team}</th>
              <th>{t.simulation.th.grp}</th>
              <th>{t.simulation.th.winGrp}</th>
              <th style={{ minWidth: 120 }}>{t.simulation.th.advance}</th>
              <th>{t.simulation.th.semis}</th>
              <th style={{ minWidth: 130 }}>{t.simulation.th.winCup}</th>
            </tr>
          </thead>
          <tbody>
            {sims.map((s, i) => (
              <tr key={s.team_id}>
                <td className="muted">{i + 1}</td>
                <td className="name">
                  <Link href={`/team/${s.team_id}`} className="teamlink">
                    <span className="flag">{flag(s.team?.country_alpha2)}</span>{' '}
                    {teamName(s.team?.name ?? null, s.team?.country_alpha2, lang) ?? s.team?.short_name ?? s.team_id}
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
      </div>

      <div className="note" style={{ marginTop: 18 }}>
        {t.simulation.note(iters)}
      </div>
    </>
  );
}
