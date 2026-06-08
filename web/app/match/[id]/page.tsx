import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getMatch, getPrediction } from '@/lib/data';
import { fmtDay, fmtTime, isLive, pct } from '@/lib/format';
import { TeamInline } from '../../components/TeamInline';
import { RealtimeRefresh } from '../../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = Number(id);
  const [m, p] = await Promise.all([getMatch(matchId), getPrediction(matchId)]);
  if (!m) notFound();

  const live = isLive(m.status_type);
  const finished = m.status_type === 'finished';
  const showScore = live || finished;

  const probs = p
    ? [
        { k: 'Home', v: pct(p.p_home) },
        { k: 'Draw', v: pct(p.p_draw) },
        { k: 'Away', v: pct(p.p_away) },
      ]
    : [];
  const max = Math.max(...probs.map((x) => x.v), 0);

  return (
    <>
      <RealtimeRefresh table="match" filter={`ss_id=eq.${matchId}`} />
      <p style={{ marginTop: 24 }}>
        <Link href="/fixtures" className="muted small">
          ← Fixtures
        </Link>
      </p>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          {m.group_name && <span className="chip group">{m.group_name}</span>}
          {live ? (
            <span className="chip live">LIVE</span>
          ) : (
            <span className="chip">{finished ? 'Finished' : 'Scheduled'}</span>
          )}
          <span className="muted small">
            {fmtDay(m.start_ts)} · {fmtTime(m.start_ts)}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <div style={{ fontSize: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
            {m.home_team_id ? (
              <Link href={`/team/${m.home_team_id}`} className="teamlink">
                <TeamInline name={m.home_name} short={m.home_short} alpha2={m.home_alpha2} align="right" />
              </Link>
            ) : (
              <TeamInline name={m.home_name} short={m.home_short} alpha2={m.home_alpha2} align="right" />
            )}
          </div>
          <div className="score" style={{ fontSize: '2rem', minWidth: 90 }}>
            {showScore ? `${m.home_score ?? 0}–${m.away_score ?? 0}` : <span className="vs">v</span>}
          </div>
          <div style={{ fontSize: '1.25rem' }}>
            {m.away_team_id ? (
              <Link href={`/team/${m.away_team_id}`} className="teamlink">
                <TeamInline name={m.away_name} short={m.away_short} alpha2={m.away_alpha2} />
              </Link>
            ) : (
              <TeamInline name={m.away_name} short={m.away_short} alpha2={m.away_alpha2} />
            )}
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Prediction{p ? ` · ${p.model_version}` : ''}</h2>
          {p ? (
            <>
              <div className="big-pred">
                {probs.map((x) => (
                  <div className={`cell${x.v === max ? ' win' : ''}`} key={x.k}>
                    <b>{x.v}%</b>
                    <span className="muted small">{x.k}</span>
                  </div>
                ))}
              </div>
              <div className="kvs">
                <span className="k">Expected goals</span>
                <span>
                  {p.exp_home_goals?.toFixed(2)} – {p.exp_away_goals?.toFixed(2)}
                </span>
                <span className="k">Model</span>
                <span>{p.model_version}</span>
              </div>
            </>
          ) : (
            <p className="muted">No prediction (knockout teams not decided yet).</p>
          )}
        </div>

        <div className="card">
          <h2>Match facts</h2>
          <div className="kvs">
            <span className="k">Kick-off</span>
            <span>
              {fmtDay(m.start_ts)} {fmtTime(m.start_ts)}
            </span>
            <span className="k">Stage</span>
            <span>{m.group_name ?? m.round_name ?? 'Knockout'}</span>
            <span className="k">Status</span>
            <span>{m.status_type ?? '—'}</span>
            <span className="k">SofaScore id</span>
            <span>{m.ss_id}</span>
          </div>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>
            Head-to-head <span className="chip tbd">TBD</span>
          </h2>
          <p className="small muted">
            From <code>/event/{'{id}'}/h2h</code> — recent meetings & aggregate record.
          </p>
        </div>
        <div className="card">
          <h2>
            Live stats / xG <span className="chip tbd">TBD</span>
          </h2>
          <p className="small muted">
            From <code>/event/{'{id}'}/statistics</code> — possession, shots, xG once live.
          </p>
        </div>
        <div className="card">
          <h2>Advanced model</h2>
          <p className="small muted">
            <b>Dixon-Coles</b> powers this prediction; tournament advance &amp; title odds come from a{' '}
            <Link href="/simulation" className="teamlink">Monte-Carlo simulation</Link>. Next:
            opponent-strength weighting &amp; market-odds blend (<code>docs/08</code>).
          </p>
        </div>
      </div>
    </>
  );
}
