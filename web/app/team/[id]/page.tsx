import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTeamHistory, getTeamInfo } from '@/lib/data';
import { flag, fmtDay } from '@/lib/format';
import type { TeamMatch } from '@/lib/types';
import { RealtimeRefresh } from '../../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  const [team, history] = await Promise.all([getTeamInfo(teamId), getTeamHistory(teamId)]);
  if (!team) notFound();

  const w = history.filter((h) => h.result === 'W').length;
  const d = history.filter((h) => h.result === 'D').length;
  const l = history.filter((h) => h.result === 'L').length;
  const gf = history.reduce((s, h) => s + (h.team_score ?? 0), 0);
  const ga = history.reduce((s, h) => s + (h.opponent_score ?? 0), 0);
  const n = history.length;
  const winPct = n ? Math.round((w / n) * 100) : 0;
  const recent = history.slice(0, 10);

  const byYear = new Map<string, TeamMatch[]>();
  for (const h of history) {
    const y = h.start_ts ? String(new Date(h.start_ts).getUTCFullYear()) : '—';
    (byYear.get(y) ?? byYear.set(y, []).get(y)!).push(h);
  }

  return (
    <>
      <RealtimeRefresh table="team_match" filter={`team_id=eq.${teamId}`} />
      <p style={{ marginTop: 24 }}>
        <Link href="/teams" className="muted small">
          ← Teams
        </Link>
      </p>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="flag" style={{ fontSize: '2rem' }}>
            {flag(team.country_alpha2)}
          </span>
          <h1 style={{ margin: 0 }}>{team.name ?? team.short_name}</h1>
        </div>

        {n > 0 ? (
          <>
            <div className="statbar" style={{ marginTop: 14 }}>
              <div className="stat">
                <b>{n}</b>
                <span className="muted small">matches</span>
              </div>
              <div className="stat">
                <b>
                  {w}-{d}-{l}
                </b>
                <span className="muted small">W-D-L</span>
              </div>
              <div className="stat">
                <b>{winPct}%</b>
                <span className="muted small">win rate</span>
              </div>
              <div className="stat">
                <b>
                  {gf}:{ga}
                </b>
                <span className="muted small">goals</span>
              </div>
            </div>
            <div className="formrow" style={{ marginTop: 12 }}>
              {recent.map((h) => (
                <span key={h.event_id} className={`res ${h.result ?? ''}`}>
                  {h.result}
                </span>
              ))}
              <span className="muted small" style={{ alignSelf: 'center', marginLeft: 6 }}>
                recent form (newest first)
              </span>
            </div>
          </>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            History still loading — run <code>npm run history</code> in the fetcher.
          </p>
        )}
      </div>

      {[...byYear.entries()].map(([year, ms]) => (
        <div key={year}>
          <div className="dayhdr">
            <h3>{year}</h3>
            <span className="muted small">{ms.length}</span>
            <span className="ln" />
          </div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {ms.map((h) => (
              <Link className="hrow" key={h.event_id} href={`/event/${h.event_id}`}>
                <span className="hdate">{fmtDay(h.start_ts)}</span>
                <span className={`res ${h.result ?? ''}`}>{h.result}</span>
                <span className="hopp">
                  <span className="venue">{h.is_home ? 'H' : 'A'}</span>
                  <span className="flag">{flag(h.opponent_alpha2)}</span>
                  <span className="nm">{h.opponent_name ?? 'Unknown'}</span>
                </span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span className="hsc">
                    {h.team_score}–{h.opponent_score}
                  </span>
                  <span className="hcomp">{h.tournament_name}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
