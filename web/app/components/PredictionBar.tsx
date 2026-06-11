import { pct } from '@/lib/format';
import { T, type Lang } from '@/lib/i18n';
import type { Prediction } from '@/lib/types';

export function PredictionBar({
  p,
  lang,
  compact = false,
}: {
  p: Prediction | undefined;
  lang: Lang;
  compact?: boolean;
}) {
  const t = T[lang].common;
  if (!p || p.p_home == null) {
    return <div className="small muted">{lang === 'hr' ? 'Još nema predikcije' : 'No prediction yet'}</div>;
  }
  const h = pct(p.p_home);
  const d = pct(p.p_draw);
  const a = pct(p.p_away);
  return (
    <div>
      <div className="predbar">
        <span className="h" style={{ width: `${h}%` }} />
        <span className="d" style={{ width: `${d}%` }} />
        <span className="a" style={{ width: `${a}%` }} />
      </div>
      {!compact && (
        <div className="predlegend">
          <span>
            {t.home} <b>{h}%</b>
          </span>
          <span>
            {t.draw} <b>{d}%</b>
          </span>
          <span>
            {t.away} <b>{a}%</b>
          </span>
        </div>
      )}
    </div>
  );
}
