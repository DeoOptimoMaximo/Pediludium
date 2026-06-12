import Link from 'next/link';
import { getCalibration, getMatches, getPredictions } from '@/lib/data';
import { dayKey, fmtDay, fmtTime, isLive } from '@/lib/format';
import { flag } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import { BASELINE_MODEL, DC_MODEL, type CalibRow, type WcMatch } from '@/lib/types';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

/** Index of the most likely outcome in [pHome, pDraw, pAway] → 0 (1) / 1 (X) / 2 (2). */
function argmax(p: number[]): 0 | 1 | 2 {
  let mi = 0;
  for (let i = 1; i < p.length; i++) if ((p[i] ?? 0) > (p[mi] ?? 0)) mi = i;
  return mi as 0 | 1 | 2;
}

function hitRate(rows: CalibRow[]): { hits: number; total: number } {
  let hits = 0;
  for (const r of rows) if (argmax(r.p) === r.outcome) hits++;
  return { hits, total: rows.length };
}

export default async function ScorecardPage() {
  const [{ lang, t }, matches, predsDC, calib] = await Promise.all([
    getDict(),
    getMatches(),
    getPredictions(DC_MODEL),
    getCalibration(),
  ]);

  const ts = t.scorecard;
  const dcRows = calib[DC_MODEL] ?? [];
  const baseRows = calib[BASELINE_MODEL] ?? [];
  const dc = hitRate(dcRows);
  const base = hitRate(baseRows);
  const calibByMatch = new Map<number, CalibRow>(dcRows.map((r) => [r.match_id, r]));

  const pctOf = (h: number, n: number) => (n ? Math.round((h / n) * 100) : 0);

  const byDay = new Map<string, WcMatch[]>();
  for (const m of matches) {
    const k = dayKey(m.start_ts);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(m);
  }

  const outcomeOf = (m: WcMatch): 0 | 1 | 2 | null => {
    if (m.home_score == null || m.away_score == null) return null;
    return m.home_score > m.away_score ? 0 : m.home_score < m.away_score ? 1 : 2;
  };

  return (
    <>
      <RealtimeRefresh table="match" />
      <h1 style={{ marginTop: 28 }}>{ts.title}</h1>
      <p className="muted">{ts.sub}</p>

      {dc.total === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <p className="muted">{ts.noneYet}</p>
        </div>
      ) : (
        <div className="card scsummary">
          <div className="scs">
            <span className="scs-lbl">Dixon-Coles</span>
            <b>{ts.hits(dc.hits, dc.total, pctOf(dc.hits, dc.total))}</b>
          </div>
          <div className="scs">
            <span className="scs-lbl">Elo + Poisson</span>
            <span className="muted">{ts.hits(base.hits, base.total, pctOf(base.hits, base.total))}</span>
          </div>
          <div className="scs-legend muted small">
            <span className="verdict hit">✓</span> {ts.correct} · <span className="verdict miss">✗</span> {ts.wrong}
          </div>
        </div>
      )}

      {[...byDay.entries()].map(([day, ms]) => (
        <div key={day}>
          <div className="dayhdr">
            <h3>{day === 'TBD' ? t.common.dateTbd : fmtDay(ms[0]!.start_ts, lang)}</h3>
            <span className="muted small">{ms.length}</span>
            <span className="ln" />
          </div>
          <div className="card" style={{ padding: '4px 14px' }}>
            {ms.map((m) => {
              const live = isLive(m.status_type);
              const finished = m.status_type === 'finished';
              const showScore = live || finished;
              // finished → frozen pre-kickoff prediction; otherwise the current one
              const frozen = calibByMatch.get(m.ss_id);
              const cur = predsDC.get(m.ss_id);
              const p = finished
                ? frozen?.p
                : cur && cur.p_home != null
                  ? [cur.p_home, cur.p_draw ?? 0, cur.p_away ?? 0]
                  : undefined;
              const pick = p ? argmax(p) : null;
              const actual = finished ? (frozen?.outcome ?? outcomeOf(m)) : null;
              const hit = pick != null && actual != null ? pick === actual : null;

              return (
                <Link className="scorerow" key={m.ss_id} href={`/match/${m.ss_id}`}>
                  <span className="sc-when">
                    {live ? <span className="chip live">{t.common.live}</span> : fmtTime(m.start_ts)}
                  </span>
                  <span className="sc-teams">
                    <span className="sc-h">
                      {teamName(m.home_name, m.home_alpha2, lang) ?? m.home_short ?? '—'}{' '}
                      <span className="flag">{flag(m.home_alpha2)}</span>
                    </span>
                    <span className="sc-score">
                      {showScore ? `${m.home_score ?? 0}–${m.away_score ?? 0}` : <span className="vs">v</span>}
                    </span>
                    <span className="sc-a">
                      <span className="flag">{flag(m.away_alpha2)}</span>{' '}
                      {teamName(m.away_name, m.away_alpha2, lang) ?? m.away_short ?? '—'}
                    </span>
                  </span>
                  <span className="sc-pred">
                    {pick != null && p ? (
                      <span className={`pickbadge${hit === true ? ' ok' : hit === false ? ' no' : ''}`}>
                        {ts.pick(pick)} · {Math.round((p[pick] ?? 0) * 100)}%
                      </span>
                    ) : (
                      <span className="muted small">{t.common.tbd}</span>
                    )}
                  </span>
                  <span className="sc-verdict">
                    {finished && hit != null ? (
                      <>
                        <span className={`verdict ${hit ? 'hit' : 'miss'}`}>{hit ? '✓' : '✗'}</span>
                        <span className="actual">{ts.pick(actual!)}</span>
                      </>
                    ) : finished ? (
                      <span className="muted small">{ts.noPred}</span>
                    ) : (
                      <span className="muted small">{live ? '' : t.common.scheduled}</span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      <div className="note" style={{ marginTop: 18 }}>
        {ts.note}
      </div>
    </>
  );
}
