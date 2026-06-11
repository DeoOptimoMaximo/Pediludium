import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTeamHistory, getTeamInfo, getTeamUpcoming } from '@/lib/data';
import { flag, fmtDay, fmtTime } from '@/lib/format';
import { groupLabel, resultLetter, teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import type { TeamMatch } from '@/lib/types';
import { RealtimeRefresh } from '../../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  const [{ lang, t }, team, history, upcoming] = await Promise.all([
    getDict(),
    getTeamInfo(teamId),
    getTeamHistory(teamId),
    getTeamUpcoming(teamId),
  ]);
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
          {t.team.back}
        </Link>
      </p>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="flag" style={{ fontSize: '2rem' }}>
            {flag(team.country_alpha2)}
          </span>
          <h1 style={{ margin: 0 }}>{teamName(team.name, team.country_alpha2, lang) ?? team.short_name}</h1>
        </div>

        {n > 0 ? (
          <>
            <div className="statbar" style={{ marginTop: 14 }}>
              <div className="stat">
                <b>{n}</b>
                <span className="muted small">{t.team.matches}</span>
              </div>
              <div className="stat">
                <b>
                  {w}-{d}-{l}
                </b>
                <span className="muted small">{t.team.wdl}</span>
              </div>
              <div className="stat">
                <b>{winPct}%</b>
                <span className="muted small">{t.team.winRate}</span>
              </div>
              <div className="stat">
                <b>
                  {gf}:{ga}
                </b>
                <span className="muted small">{t.team.goals}</span>
              </div>
            </div>
            <div className="formrow" style={{ marginTop: 12 }}>
              {recent.map((h) => (
                <span key={h.event_id} className={`res ${h.result ?? ''}`}>
                  {resultLetter(h.result, lang)}
                </span>
              ))}
              <span className="muted small" style={{ alignSelf: 'center', marginLeft: 6 }}>
                {t.team.recentForm}
              </span>
            </div>
          </>
        ) : (
          <p className="muted" style={{ marginTop: 12 }}>
            {t.team.historyLoading}
          </p>
        )}
      </div>

      {/* FUTURE — upcoming WC2026 fixtures (soonest first) */}
      {upcoming.length > 0 && (
        <div>
          <div className="dayhdr">
            <h3>{t.team.upcoming}</h3>
            <span className="muted small">{upcoming.length}</span>
            <span className="ln" />
          </div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {upcoming.map((m) => {
              const isHome = m.home_team_id === teamId;
              const oppName = isHome ? m.away_name : m.home_name;
              const oppAlpha2 = isHome ? m.away_alpha2 : m.home_alpha2;
              const live = m.status_type === 'inprogress';
              return (
                <Link className="urow" key={m.ss_id} href={`/match/${m.ss_id}`}>
                  <span className="hdate">{fmtDay(m.start_ts, lang)}</span>
                  <span className="venue" style={{ justifySelf: 'center' }}>
                    {isHome ? t.common.homeShort : t.common.awayShort}
                  </span>
                  <span className="hopp">
                    <span className="flag">{flag(oppAlpha2)}</span>
                    <span className="nm">{teamName(oppName, oppAlpha2, lang) ?? t.common.tbd}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {live ? (
                      <span className="chip live">{t.common.live}</span>
                    ) : (
                      <span className="kick">{fmtTime(m.start_ts)}</span>
                    )}
                    {m.group_name && <span className="chip group">{groupLabel(m.group_name, lang)}</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* PRESENT limiter — above is FUTURE, below is PAST */}
      <div className="nowline" role="separator" aria-label="Present — future above, past below">
        <span className="ln l" />
        <span className="now">{t.team.present}</span>
        <span className="ln r" />
      </div>

      {/* PAST — historical results grouped by year (newest first) */}
      {[...byYear.entries()].map(([year, ms]) => (
        <div key={year}>
          <div className="dayhdr">
            <h3>{year}</h3>
            <span className="muted small">{ms.length}</span>
            <span className="ln" />
          </div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {ms.map((h) => (
              <Link className="hrow" key={h.event_id} href={`/match/${h.event_id}`}>
                <span className="hdate">{fmtDay(h.start_ts, lang)}</span>
                <span className={`res ${h.result ?? ''}`}>{resultLetter(h.result, lang)}</span>
                <span className="hopp">
                  <span className="venue">{h.is_home ? t.common.homeShort : t.common.awayShort}</span>
                  <span className="flag">{flag(h.opponent_alpha2)}</span>
                  <span className="nm">{teamName(h.opponent_name, h.opponent_alpha2, lang) ?? t.common.unknown}</span>
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
