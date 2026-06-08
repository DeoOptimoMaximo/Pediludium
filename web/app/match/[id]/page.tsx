import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEventDetail, getMatch, getPrediction } from '@/lib/data';
import { flag, fmtDay, fmtTime, isLive, pct } from '@/lib/format';
import type { EventDetail, WcMatch } from '@/lib/types';
import { TeamInline } from '../../components/TeamInline';
import { BackButton } from '../../components/BackButton';
import { RealtimeRefresh } from '../../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

/**
 * Canonical event detail route. The same real-world match can live in two tables that
 * share the SofaScore event-id namespace (docs/04): `match` (rich, WC2026-scoped) and
 * `team_match` (denormalized history). We resolve match-first so a played WC fixture always
 * shows its rich view, and fall back to the historical view for everything else.
 * /event/[id] redirects here.
 */
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = Number(id);

  const m = await getMatch(matchId);
  if (m) return <WcMatchView m={m} matchId={matchId} p={await getPrediction(matchId)} />;

  const ev = await getEventDetail(matchId);
  if (ev) return <HistoricalEventView ev={ev} />;

  notFound();
}

/* ── Rich WC2026 view (from public.match) ──────────────────────────────── */
async function WcMatchView({
  m,
  matchId,
  p,
}: {
  m: WcMatch;
  matchId: number;
  p: Awaited<ReturnType<typeof getPrediction>>;
}) {
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
            From <code>/event/{'{id}'}/h2h</code> — recent meetings &amp; aggregate record.
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

/* ── Historical view (from public.team_match) ──────────────────────────── */
function HistoricalEventView({ ev }: { ev: EventDetail }) {
  const finished = ev.status_type === 'finished' || ev.home.score != null;
  const hs = ev.home.score;
  const as = ev.away.score;
  const homeWin = finished && hs != null && as != null && hs > as;
  const awayWin = finished && hs != null && as != null && as > hs;

  return (
    <>
      <RealtimeRefresh table="team_match" filter={`event_id=eq.${ev.event_id}`} />
      <p style={{ marginTop: 24 }}>
        <BackButton />
      </p>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          {ev.competition && <span className="chip group">{ev.competition}</span>}
          {ev.round && <span className="chip">{ev.round}</span>}
          <span className="chip">{finished ? 'Finished' : (ev.status_type ?? 'Scheduled')}</span>
          <span className="muted small">
            {fmtDay(ev.start_ts)} · {fmtTime(ev.start_ts)}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 18 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '2.4rem', lineHeight: 1 }}>{flag(ev.home.alpha2)}</div>
            <div style={{ fontWeight: 700, fontSize: '1.15rem', marginTop: 6, opacity: homeWin ? 1 : 0.8 }}>
              {ev.home.name ?? 'Home'}
            </div>
          </div>
          <div className="score" style={{ fontSize: '2.4rem', minWidth: 110, textAlign: 'center' }}>
            {finished ? `${hs ?? 0}–${as ?? 0}` : <span className="vs">v</span>}
          </div>
          <div>
            <div style={{ fontSize: '2.4rem', lineHeight: 1 }}>{flag(ev.away.alpha2)}</div>
            <div style={{ fontWeight: 700, fontSize: '1.15rem', marginTop: 6, opacity: awayWin ? 1 : 0.8 }}>
              {ev.away.name ?? 'Away'}
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Match facts</h2>
          <div className="kvs">
            <span className="k">Date</span>
            <span>
              {fmtDay(ev.start_ts)} {fmtTime(ev.start_ts)}
            </span>
            <span className="k">Competition</span>
            <span>{ev.competition ?? '—'}</span>
            <span className="k">Round</span>
            <span>{ev.round ?? '—'}</span>
            <span className="k">Result</span>
            <span>{finished ? `${ev.home.name} ${hs}–${as} ${ev.away.name}` : 'Not played'}</span>
            <span className="k">SofaScore id</span>
            <span>{ev.event_id}</span>
          </div>
        </div>

        <div className="card">
          <h2>
            Stats / lineups / incidents <span className="chip tbd">TBD</span>
          </h2>
          <p className="small muted">
            Not yet ingested for historical matches. Fetchable on demand from{' '}
            <code>/event/{ev.event_id}/statistics</code>, <code>/lineups</code>,{' '}
            <code>/incidents</code> (via the fetcher / mobile IP), then shown here.
          </p>
        </div>
      </div>
    </>
  );
}
