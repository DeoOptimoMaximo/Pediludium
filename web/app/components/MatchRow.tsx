import Link from 'next/link';
import { fmtTime, isLive } from '@/lib/format';
import { T, type Lang } from '@/lib/i18n';
import type { Prediction, WcMatch } from '@/lib/types';
import { PredictionBar } from './PredictionBar';
import { TeamInline } from './TeamInline';

export function MatchRow({ m, p, lang }: { m: WcMatch; p?: Prediction; lang: Lang }) {
  const live = isLive(m.status_type);
  const finished = m.status_type === 'finished';
  const showScore = live || finished;
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
          <PredictionBar p={p} lang={lang} compact />
        </div>
      </div>
    </Link>
  );
}
