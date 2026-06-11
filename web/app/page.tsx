import Link from 'next/link';
import { getMatches, getPredictions, getRatings, getSimulations, getSnapshotMeta } from '@/lib/data';
import { flag, fmtDay } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import { Countdown } from './components/Countdown';
import { LiveTicker } from './components/LiveTicker';
import { MatchRow } from './components/MatchRow';
import { ProbBar } from './components/ProbBar';
import { RealtimeRefresh } from './components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const [{ lang, t }, matches, preds, ratings, sims, snap] = await Promise.all([
    getDict(),
    getMatches(),
    getPredictions(),
    getRatings(),
    getSimulations(),
    getSnapshotMeta(),
  ]);
  const upcoming = matches.filter((m) => m.status_type !== 'finished').slice(0, 7);
  const opener = matches[0];
  const top = ratings.slice(0, 10);
  const liveCount = matches.filter((m) => m.status_type === 'inprogress').length;
  const isSnapshot = snap != null;

  // Croatia front and center — the team this site follows above all
  const cro = sims.find((s) => s.team?.country_alpha2 === 'HR');
  const croNext = cro
    ? matches.find(
        (m) =>
          (m.home_team_id === cro.team_id || m.away_team_id === cro.team_id) &&
          m.status_type !== 'finished',
      )
    : undefined;

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

      {cro && (
        <section className="card crocard" style={{ marginBottom: 14 }}>
          <div className="crohead">
            <span className="flag" style={{ fontSize: '1.9rem' }}>{flag('HR')}</span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0 }}>{t.homePage.croTitle}</h2>
              <span className="muted small">{t.homePage.croSub}</span>
            </div>
            <Link href={`/team/${cro.team_id}`} className="btn" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {t.homePage.croProfile}
            </Link>
          </div>
          {croNext && (
            <>
              <div className="dayhdr" style={{ margin: '12px 0 2px' }}>
                <h3>{t.homePage.croNext}</h3>
                <span className="muted small">{fmtDay(croNext.start_ts, lang)}</span>
                <span className="ln" />
              </div>
              <MatchRow m={croNext} p={preds.get(croNext.ss_id)} lang={lang} />
            </>
          )}
          <div className="crostats">
            <div>
              <span className="muted small">{t.simulation.th.advance}</span>
              <ProbBar value={cro.p_advance} tone="home" />
            </div>
            <div>
              <span className="muted small">{t.simulation.th.semis}</span>
              <ProbBar value={cro.p_sf} tone="muted" />
            </div>
            <div>
              <span className="muted small">{t.simulation.th.winCup}</span>
              <ProbBar value={cro.p_win_cup} tone="accent" />
            </div>
          </div>
        </section>
      )}

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
            <Link
              className={`rank${r.team?.country_alpha2 === 'HR' ? ' hl-cro' : ''}`}
              key={r.team_id}
              href={`/team/${r.team_id}`}
            >
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
