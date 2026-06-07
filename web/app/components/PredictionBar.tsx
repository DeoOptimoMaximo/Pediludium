import { pct } from '@/lib/format';
import type { Prediction } from '@/lib/types';

export function PredictionBar({ p, compact = false }: { p: Prediction | undefined; compact?: boolean }) {
  if (!p || p.p_home == null) {
    return <div className="small muted">No prediction yet</div>;
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
            Home <b>{h}%</b>
          </span>
          <span>
            Draw <b>{d}%</b>
          </span>
          <span>
            Away <b>{a}%</b>
          </span>
        </div>
      )}
    </div>
  );
}
