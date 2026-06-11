import Link from 'next/link';
import { getMatches, getPredictions, getRatings, getSnapshotMeta } from '@/lib/data';
import { flag, fmtDay } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import { Countdown } from './components/Countdown';
import { LiveTicker } from './components/LiveTicker';
import { MatchRow } from './components/MatchRow';
import { RealtimeRefresh } from './components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [{ lang, t }, matches, preds, ratings, snap] = await Promise.all([
    getDict(),
    getMatches(),
    getPredictions(),
    getRatings(),
    getSnapshotMeta(),
  ]);
  const upcoming = matches.filter((m) => m.status_type !== 'finished').slice(0, 7);
  const opener = matches[0];
  const top = ratings.slice(0, 10);
  const liveCount = matches.filter((m) => m.status_type === 'inprogress').length;
  const isSnapshot = snap != null;

  return (
    <>
      <RealtimeRefresh table="match" />
      <RealtimeRefresh table="prediction" channel="rt-pred-overview" />
      <section className="hero">
        <div className="kicker">{t.homePage.kicker}</div>
        <h1>Lopta je okrugla</h1>
        <p className="muted" style={{ maxWidth: 560 }}>
          {t.homePage.tagline}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          <LiveTicker lang={lang} staticCount={isSnapshot ? liveCount : undefined} />
          {opener?.start_ts && (
            <span className="muted small">
              {t.homePage.kickOff} {fmtDay(opener.start_ts, lang)}
            </span>
          )}
          {snap && (
            <span className="muted small">
              {t.homePage.dataAsOf}: {new Date(snap.generated_at).toUTCString().slice(5, 22)} UTC
            </span>
          )}
        </div>
        {opener?.start_ts && <Countdown toIso={opener.start_ts} labels={t.countdown} />}
        <div className="btnrow">
          <a className="btn primary" href="/fixtures">
            {t.homePage.btnFixtures}
          </a>
          <a className="btn" href="/groups">
            {t.homePage.btnGroups}
          </a>
          <a className="btn" href="/predictions">
            {t.homePage.btnPredictions}
          </a>
        </div>
      </section>

      <div className="grid cols-2">
        <div className="card">
          <h2>{t.homePage.nextUp}</h2>
          {upcoming.map((m) => (
            <MatchRow key={m.ss_id} m={m} p={preds.get(m.ss_id)} lang={lang} />
          ))}
        </div>

        <div className="card">
          <h2>{t.homePage.powerRanking}</h2>
          <p className="small muted" style={{ marginTop: -4 }}>
            {t.homePage.powerRankingSub}
          </p>
          {top.map((r, i) => (
            <Link className="rank" key={r.team_id} href={`/team/${r.team_id}`}>
              <span className="pos">{i + 1}</span>
              <span className="flag">{flag(r.team?.country_alpha2)}</span>
              <span className="nm">
                {teamName(r.team?.name ?? null, r.team?.country_alpha2, lang) ?? r.team?.short_name ?? r.team_id}
              </span>
              <span className="rt">{r.rating}</span>
            </Link>
          ))}
        </div>
      </div>

      <p className="note" style={{ marginTop: 18 }}>
        {t.homePage.note}
      </p>
    </>
  );
}
