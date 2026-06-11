import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEventDetail, getMatch, getPrediction } from '@/lib/data';
import { flag, fmtDay, fmtTime, isLive, pct } from '@/lib/format';
import { groupLabel, teamName, type Dict, type Lang } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import type { EventDetail, WcMatch } from '@/lib/types';
import { TeamInline } from '../../components/TeamInline';
import { BackButton } from '../../components/BackButton';
import { RealtimeRefresh } from '../../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

/**
 * Canonical event detail route. The same real-world match can live in two tables that
 * share the source event-id namespace (docs/04): `match` (rich, WC2026-scoped) and
 * `team_match` (denormalized history). We resolve match-first so a played WC fixture always
 * shows its rich view, and fall back to the historical view for everything else.
 * /event/[id] redirects here.
 */
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const matchId = Number(id);
  const { lang, t } = await getDict();

  const m = await getMatch(matchId);
  if (m) return <WcMatchView m={m} matchId={matchId} p={await getPrediction(matchId)} lang={lang} t={t} />;

  const ev = await getEventDetail(matchId);
  if (ev) return <HistoricalEventView ev={ev} lang={lang} t={t} />;

  notFound();
}

/* ── Rich WC2026 view (from public.match) ──────────────────────────────── */
async function WcMatchView({
  m,
  matchId,
  p,
  lang,
  t,
}: {
  m: WcMatch;
  matchId: number;
  p: Awaited<ReturnType<typeof getPrediction>>;
  lang: Lang;
  t: Dict;
}) {
  const live = isLive(m.status_type);
  const finished = m.status_type === 'finished';
  const showScore = live || finished;

  const probs = p
    ? [
        { k: t.common.home, v: pct(p.p_home) },
        { k: t.common.draw, v: pct(p.p_draw) },
        { k: t.common.away, v: pct(p.p_away) },
      ]
    : [];
  const max = Math.max(...probs.map((x) => x.v), 0);

  return (
    <>
      <RealtimeRefresh table="match" filter={`ss_id=eq.${matchId}`} />
      <p style={{ marginTop: 24 }}>
        <Link href="/fixtures" className="muted small">
          {t.match.backFixtures}
        </Link>
      </p>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {m.group_name && <span className="chip group">{groupLabel(m.group_name, lang)}</span>}
          {live ? (
            <span className="chip live">{t.common.live}</span>
          ) : (
            <span className="chip">{finished ? t.common.finished : t.common.scheduled}</span>
          )}
          <span className="muted small">
            {fmtDay(m.start_ts, lang)} · {fmtTime(m.start_ts)}
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
          <div style={{ fontSize: '1.25rem', display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
            {m.home_team_id ? (
              <Link href={`/team/${m.home_team_id}`} className="teamlink">
                <TeamInline name={m.home_name} short={m.home_short} alpha2={m.home_alpha2} lang={lang} align="right" />
              </Link>
            ) : (
              <TeamInline name={m.home_name} short={m.home_short} alpha2={m.home_alpha2} lang={lang} align="right" />
            )}
          </div>
          <div className="score" style={{ fontSize: '2rem', minWidth: 90 }}>
            {showScore ? `${m.home_score ?? 0}–${m.away_score ?? 0}` : <span className="vs">v</span>}
          </div>
          <div style={{ fontSize: '1.25rem', minWidth: 0 }}>
            {m.away_team_id ? (
              <Link href={`/team/${m.away_team_id}`} className="teamlink">
                <TeamInline name={m.away_name} short={m.away_short} alpha2={m.away_alpha2} lang={lang} />
              </Link>
            ) : (
              <TeamInline name={m.away_name} short={m.away_short} alpha2={m.away_alpha2} lang={lang} />
            )}
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>{t.match.prediction}{p ? ` · ${p.model_version}` : ''}</h2>
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
                <span className="k">{t.match.expGoals}</span>
                <span>
                  {p.exp_home_goals?.toFixed(2)} – {p.exp_away_goals?.toFixed(2)}
                </span>
                <span className="k">{t.common.model}</span>
                <span>{p.model_version}</span>
              </div>
            </>
          ) : (
            <p className="muted">{t.match.noPrediction}</p>
          )}
        </div>

        <div className="card">
          <h2>{t.match.facts}</h2>
          <div className="kvs">
            <span className="k">{t.match.kickOff}</span>
            <span>
              {fmtDay(m.start_ts, lang)} {fmtTime(m.start_ts)}
            </span>
            <span className="k">{t.match.stage}</span>
            <span>{groupLabel(m.group_name, lang) ?? m.round_name ?? t.common.knockout}</span>
            <span className="k">{t.match.status}</span>
            <span>{t.match.statusOf(m.status_type)}</span>
          </div>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>
            {t.match.h2h} <span className="chip tbd">{t.common.soon}</span>
          </h2>
          <p className="small muted">{t.match.h2hSoon}</p>
        </div>
        <div className="card">
          <h2>
            {t.match.liveStats} <span className="chip tbd">{t.common.soon}</span>
          </h2>
          <p className="small muted">{t.match.liveStatsSoon}</p>
        </div>
        <div className="card">
          <h2>{t.match.advanced}</h2>
          <p className="small muted">
            {t.match.advancedText[0]}
            <Link href="/simulation" className="teamlink">{t.match.advancedText[1]}</Link>
            {t.match.advancedText[2]}
          </p>
        </div>
      </div>
    </>
  );
}

/* ── Historical view (from public.team_match) ──────────────────────────── */
function HistoricalEventView({ ev, lang, t }: { ev: EventDetail; lang: Lang; t: Dict }) {
  const finished = ev.status_type === 'finished' || ev.home.score != null;
  const hs = ev.home.score;
  const as = ev.away.score;
  const homeWin = finished && hs != null && as != null && hs > as;
  const awayWin = finished && hs != null && as != null && as > hs;
  const homeName = teamName(ev.home.name, ev.home.alpha2, lang) ?? t.common.home;
  const awayName = teamName(ev.away.name, ev.away.alpha2, lang) ?? t.common.away;

  return (
    <>
      <RealtimeRefresh table="team_match" filter={`event_id=eq.${ev.event_id}`} />
      <p style={{ marginTop: 24 }}>
        <BackButton label={lang === 'hr' ? '← Natrag' : '← Back'} />
      </p>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {ev.competition && <span className="chip group">{ev.competition}</span>}
          {ev.round && <span className="chip">{ev.round}</span>}
          <span className="chip">{finished ? t.common.finished : t.common.scheduled}</span>
          <span className="muted small">
            {fmtDay(ev.start_ts, lang)} · {fmtTime(ev.start_ts)}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 18 }}>
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div style={{ fontSize: '2.4rem', lineHeight: 1 }}>{flag(ev.home.alpha2)}</div>
            <div style={{ fontWeight: 700, fontSize: '1.15rem', marginTop: 6, opacity: homeWin ? 1 : 0.8 }}>
              {homeName}
            </div>
          </div>
          <div className="score" style={{ fontSize: '2.4rem', minWidth: 90, textAlign: 'center' }}>
            {finished ? `${hs ?? 0}–${as ?? 0}` : <span className="vs">v</span>}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '2.4rem', lineHeight: 1 }}>{flag(ev.away.alpha2)}</div>
            <div style={{ fontWeight: 700, fontSize: '1.15rem', marginTop: 6, opacity: awayWin ? 1 : 0.8 }}>
              {awayName}
            </div>
          </div>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>{t.match.facts}</h2>
          <div className="kvs">
            <span className="k">{t.match.date}</span>
            <span>
              {fmtDay(ev.start_ts, lang)} {fmtTime(ev.start_ts)}
            </span>
            <span className="k">{t.match.competition}</span>
            <span>{ev.competition ?? '—'}</span>
            <span className="k">{t.match.round}</span>
            <span>{ev.round ?? '—'}</span>
            <span className="k">{t.match.result}</span>
            <span>{finished ? `${homeName} ${hs}–${as} ${awayName}` : t.common.notPlayed}</span>
          </div>
        </div>

        <div className="card">
          <h2>
            {t.match.histStatsTitle} <span className="chip tbd">{t.common.soon}</span>
          </h2>
          <p className="small muted">{t.match.histStatsSoon}</p>
        </div>
      </div>
    </>
  );
}
