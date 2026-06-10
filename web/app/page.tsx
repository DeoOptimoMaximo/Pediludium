import Link from 'next/link';
import { getMatches, getPredictions, getRatings, getSnapshotMeta, isSnapshot } from '@/lib/data';
import { flag, fmtDay } from '@/lib/format';
import { Countdown } from './components/Countdown';
import { LiveTicker } from './components/LiveTicker';
import { MatchRow } from './components/MatchRow';
import { RealtimeRefresh } from './components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [matches, preds, ratings, snap] = await Promise.all([
    getMatches(),
    getPredictions(),
    getRatings(),
    getSnapshotMeta(),
  ]);
  const upcoming = matches.filter((m) => m.status_type !== 'finished').slice(0, 7);
  const opener = matches[0];
  const top = ratings.slice(0, 10);
  const liveCount = matches.filter((m) => m.status_type === 'inprogress').length;

  return (
    <>
      <RealtimeRefresh table="match" />
      <RealtimeRefresh table="prediction" channel="rt-pred-overview" />
      <section className="hero">
        <div className="kicker">FIFA World Cup 2026 · USA · Canada · Mexico</div>
        <h1>Pediludium</h1>
        <p className="muted" style={{ maxWidth: 560 }}>
          {isSnapshot
            ? 'Open analytics for the 48-team World Cup: Dixon-Coles predictions and Monte-Carlo tournament odds, recomputed and republished on a fixed schedule.'
            : 'Private realtime tracking & baseline analytics for the 48-team World Cup. Data mirrored from SofaScore into our own database — the app reads only from us.'}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10 }}>
          <LiveTicker staticCount={isSnapshot ? liveCount : undefined} />
          {opener?.start_ts && <span className="muted small">Kick-off {fmtDay(opener.start_ts)}</span>}
          {snap && (
            <span className="muted small">
              Snapshot {new Date(snap.generated_at).toUTCString().slice(5, 22)} UTC
            </span>
          )}
        </div>
        {opener?.start_ts && <Countdown toIso={opener.start_ts} />}
        <div className="btnrow">
          <a className="btn primary" href="/fixtures">
            All fixtures
          </a>
          <a className="btn" href="/groups">
            Groups & standings
          </a>
          <a className="btn" href="/predictions">
            Predictions
          </a>
        </div>
      </section>

      <div className="grid cols-2">
        <div className="card">
          <h2>Next up</h2>
          {upcoming.map((m) => (
            <MatchRow key={m.ss_id} m={m} p={preds.get(m.ss_id)} />
          ))}
        </div>

        <div className="card">
          <h2>Power ranking · Elo</h2>
          <p className="small muted" style={{ marginTop: -4 }}>
            Recent-form rating from match history (baseline).
          </p>
          {top.map((r, i) => (
            <Link className="rank" key={r.team_id} href={`/team/${r.team_id}`}>
              <span className="pos">{i + 1}</span>
              <span className="flag">{flag(r.team?.country_alpha2)}</span>
              <span className="nm">{r.team?.name ?? r.team?.short_name ?? r.team_id}</span>
              <span className="rt">{r.rating}</span>
            </Link>
          ))}
        </div>
      </div>

      <p className="note" style={{ marginTop: 18 }}>
        Predictions are a transparent <b>Elo + Poisson baseline</b>. Advanced modelling
        (Dixon-Coles, xG, market-odds blend, Monte-Carlo tournament simulation) is planned —
        see the <b>TODO/TBD</b> markers on match pages and <code>docs/08-prediction-roadmap.md</code>.
      </p>
    </>
  );
}
