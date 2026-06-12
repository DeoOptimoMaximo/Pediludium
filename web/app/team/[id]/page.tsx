import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTeamHistory, getTeamInfo, getTeamSeries, getTeamWcMatches } from '@/lib/data';
import { flag, fmtDay, fmtTime } from '@/lib/format';
import { groupLabel, resultLetter, teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import { SIM_MODEL, type TeamMatch } from '@/lib/types';
import { RealtimeRefresh } from '../../components/RealtimeRefresh';
import { SeriesChart } from '../../components/SeriesChart';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const teamId = Number(id);
  const [{ lang, t }, team, history, wcMatches, series] = await Promise.all([
    getDict(),
    getTeamInfo(teamId),
    getTeamHistory(teamId),
    getTeamWcMatches(teamId),
    getTeamSeries(teamId),
  ]);
  if (!team) notFound();

  // split this team's WC2026 fixtures: not-yet-finished above the present line,
  // finished results just below it (newest first) — they live in `match`, not the
  // historical `team_match` table, so without this they'd vanish once played
  const upcoming = wcMatches.filter((m) => m.status_type !== 'finished');
  const wcResults = wcMatches.filter((m) => m.status_type === 'finished').reverse();

  const simPts = series?.[SIM_MODEL] ?? [];
  // scale the odds chart to the team's advance probability, not the full 0–100%
  const simYMax = Math.min(1, Math.max(0.05, ...simPts.map((p) => p[1])) * 1.15);
  const span = (epoch: number) => {
    const iso = new Date(epoch * 1000).toISOString();
    return `${fmtDay(iso, lang)} ${fmtTime(iso)}`;
  };

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

      {/* How the tournament forecast for this team moved across hourly snapshots */}
      {simPts.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>{t.team.oddsTimeline}</h2>
          <p className="small muted" style={{ marginTop: -2 }}>{t.team.oddsTimelineNote}</p>
          <SeriesChart
            lines={[
              { label: t.simulation.th.advance, color: 'var(--home)', points: simPts.map((p) => [p[0], p[1]]) },
              { label: t.simulation.th.semis, color: 'var(--draw)', points: simPts.map((p) => [p[0], p[3]]) },
              { label: t.simulation.th.winCup, color: 'var(--accent)', points: simPts.map((p) => [p[0], p[2]]) },
            ]}
            yMax={simYMax}
            xLabels={[span(simPts[0]![0]), span(simPts[simPts.length - 1]![0])]}
            yLabel={`0–${Math.round(simYMax * 100)}%`}
          />
        </div>
      )}

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

      {/* WC2026 results — finished this tournament (from `match`, newest first) */}
      {wcResults.length > 0 && (
        <div>
          <div className="dayhdr">
            <h3>{t.team.wcResults}</h3>
            <span className="muted small">{wcResults.length}</span>
            <span className="ln" />
          </div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {wcResults.map((m) => {
              const isHome = m.home_team_id === teamId;
              const teamScore = isHome ? m.home_score : m.away_score;
              const oppScore = isHome ? m.away_score : m.home_score;
              const oppName = isHome ? m.away_name : m.home_name;
              const oppAlpha2 = isHome ? m.away_alpha2 : m.home_alpha2;
              const res =
                teamScore == null || oppScore == null
                  ? null
                  : teamScore > oppScore
                    ? 'W'
                    : teamScore < oppScore
                      ? 'L'
                      : 'D';
              return (
                <Link className="hrow" key={m.ss_id} href={`/match/${m.ss_id}`}>
                  <span className="hdate">{fmtDay(m.start_ts, lang)}</span>
                  <span className={`res ${res ?? ''}`}>{resultLetter(res, lang)}</span>
                  <span className="hopp">
                    <span className="venue">{isHome ? t.common.homeShort : t.common.awayShort}</span>
                    <span className="flag">{flag(oppAlpha2)}</span>
                    <span className="nm">{teamName(oppName, oppAlpha2, lang) ?? t.common.tbd}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="hsc">
                      {teamScore}–{oppScore}
                    </span>
                    {m.group_name && <span className="hcomp">{groupLabel(m.group_name, lang)}</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

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
