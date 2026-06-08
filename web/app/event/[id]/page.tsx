import { notFound } from 'next/navigation';
import { getEventDetail } from '@/lib/data';
import { flag, fmtDay, fmtTime } from '@/lib/format';
import { RealtimeRefresh } from '../../components/RealtimeRefresh';
import { BackButton } from '../../components/BackButton';

export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ev = await getEventDetail(Number(id));
  if (!ev) notFound();

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
