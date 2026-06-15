import Link from 'next/link';
import { fmtTime, isLive } from '@/lib/format';
import { T, type Lang } from '@/lib/i18n';
import type { Prediction, WcMatch } from '@/lib/types';
import { PredictionBar } from './PredictionBar';
import { TeamInline } from './TeamInline';

/**
 * For a finished match, grade the frozen pre-match prediction against the real result:
 * did the model's most-likely 1-X-2 call match the actual outcome, and what probability
 * did it assign to what actually happened? Returns null when we can't score it.
 */
function verdict(m: WcMatch, p?: Prediction): { hit: boolean; pick: 0 | 1 | 2; pActual: number } | null {
  if (m.status_type !== 'finished' || !p || p.p_home == null || p.p_draw == null || p.p_away == null)
    return null;
  if (m.home_score == null || m.away_score == null) return null;
  const probs = [p.p_home, p.p_draw, p.p_away];
  const pick = probs.indexOf(Math.max(...probs)) as 0 | 1 | 2;
  const actual: 0 | 1 | 2 = m.home_score > m.away_score ? 0 : m.home_score === m.away_score ? 1 : 2;
  return { hit: pick === actual, pick: actual, pActual: probs[actual] };
}

export function MatchRow({ m, p, lang }: { m: WcMatch; p?: Prediction; lang: Lang }) {
  const live = isLive(m.status_type);
  const finished = m.status_type === 'finished';
  const showScore = live || finished;
  const v = verdict(m, p);
  const sc = T[lang].scorecard;
  return (
    <Link href={`/match/${m.ss_id}`} style={{ display: 'block' }}>
      <div className="match">
        <div className="when">
          {live ? <span className="chip live">{T[lang].common.live}</span> : fmtTime(m.start_ts)}
        </div>
        <div className="teams">
          <div className="h">
            <TeamInline name={m.home_name} short={m.home_short} alpha2={m.home_alpha2} lang={lang} align="right" />
          </div>
          <div className="score">
            {showScore ? `${m.home_score ?? 0}–${m.away_score ?? 0}` : <span className="vs">v</span>}
          </div>
          <div>
            <TeamInline name={m.away_name} short={m.away_short} alpha2={m.away_alpha2} lang={lang} />
          </div>
        </div>
        <div className="predcol">
          {v ? (
            <span
              className={`vchip ${v.hit ? 'ok' : 'no'}`}
              title={`${v.hit ? sc.correct : sc.wrong} · ${Math.round(v.pActual * 100)}% ${sc.pick(v.pick)}`}
            >
              {v.hit ? '✓' : '✗'} {Math.round(v.pActual * 100)}%
            </span>
          ) : (
            <PredictionBar p={p} lang={lang} compact />
          )}
        </div>
      </div>
    </Link>
  );
}
