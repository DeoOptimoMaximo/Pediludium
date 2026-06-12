import Link from 'next/link';
import { getMovers, getStandings } from '@/lib/data';
import { flag } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import type { MoverRow } from '@/lib/types';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

/** Signed percentage-point delta, e.g. +3.2 / −1.0, coloured by direction. */
function Delta({ d }: { d: number }) {
  const pp = d * 100;
  const cls = pp > 0.05 ? 'up' : pp < -0.05 ? 'down' : 'flat';
  const sign = pp > 0.05 ? '+' : pp < -0.05 ? '−' : '±';
  const mag = Math.abs(pp);
  const text = mag < 0.1 ? '0' : mag.toFixed(mag < 10 ? 1 : 0);
  return <span className={`delta ${cls}`}>{sign}{text}</span>;
}

function MoverList({
  rows,
  lang,
  groupOf,
  metric,
  th,
}: {
  rows: MoverRow[];
  lang: 'hr' | 'en';
  groupOf: Map<number, string>;
  metric: 'advance' | 'title';
  th: { team: string; grp: string; advance: string; title: string };
}) {
  return (
    <div className="tblwrap">
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>{th.team}</th>
            <th>{th.grp}</th>
            <th style={{ minWidth: 96 }}>{metric === 'advance' ? th.advance : th.title}</th>
            <th>Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const now = (metric === 'advance' ? r.p_advance : r.p_win_cup) ?? 0;
            const d = metric === 'advance' ? r.d_advance : r.d_win_cup;
            return (
              <tr key={r.team_id} className={r.team?.country_alpha2 === 'HR' ? 'hl-cro' : undefined}>
                <td className="name">
                  <Link href={`/team/${r.team_id}`} className="teamlink">
                    <span className="flag">{flag(r.team?.country_alpha2)}</span>{' '}
                    {teamName(r.team?.name ?? null, r.team?.country_alpha2, lang) ?? r.team?.short_name ?? r.team_id}
                  </Link>
                </td>
                <td>
                  <span className="chip group">{groupOf.get(r.team_id) ?? '–'}</span>
                </td>
                <td className="num">{Math.round(now * 100)}%</td>
                <td className="num"><Delta d={d} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function MoversPage() {
  const [{ lang, t }, movers, standings] = await Promise.all([getDict(), getMovers(), getStandings()]);

  const groupOf = new Map<number, string>();
  for (const s of standings) {
    if (s.team_id != null && s.group_name?.startsWith('Group ')) {
      groupOf.set(s.team_id, s.group_name.replace('Group ', ''));
    }
  }

  const tm = t.movers;
  const teams = movers?.teams ?? [];
  // headline metric: title odds barely move pre-knockout, so rank movement by advance %
  const byMove = [...teams].sort((a, b) => Math.abs(b.d_advance) - Math.abs(a.d_advance));
  const risers = byMove.filter((r) => r.d_advance > 0.0005).slice(0, 12);
  const fallers = byMove.filter((r) => r.d_advance < -0.0005).sort((a, b) => a.d_advance - b.d_advance).slice(0, 12);
  const anyMovement = risers.length > 0 || fallers.length > 0;

  return (
    <>
      <RealtimeRefresh table="tournament_simulation" />
      <h1 style={{ marginTop: 28 }}>{tm.title}</h1>
      <p className="muted">{tm.sub(movers?.window_h ?? 24)}</p>

      {!movers || teams.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <p className="muted">{tm.empty}</p>
        </div>
      ) : !anyMovement ? (
        <div className="card" style={{ padding: 18 }}>
          <p className="muted">{tm.quiet}</p>
        </div>
      ) : (
        <div className="movers-grid">
          <section className="card" style={{ padding: '6px 14px' }}>
            <h2 className="movers-h up">↑ {tm.risers}</h2>
            <MoverList rows={risers} lang={lang} groupOf={groupOf} metric="advance" th={tm.th} />
          </section>
          <section className="card" style={{ padding: '6px 14px' }}>
            <h2 className="movers-h down">↓ {tm.fallers}</h2>
            <MoverList rows={fallers} lang={lang} groupOf={groupOf} metric="advance" th={tm.th} />
          </section>
        </div>
      )}

      <div className="note" style={{ marginTop: 18 }}>
        {tm.note}
      </div>
    </>
  );
}
