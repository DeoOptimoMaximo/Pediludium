import { pct } from '@/lib/format';

/**
 * A compact probability cell: a horizontal bar (width scaled to `max`, default 1 = 100%)
 * with the percentage alongside. Used in the forecast table and group standings.
 */
export function ProbBar({
  value,
  max = 1,
  tone = 'accent',
  showZero = true,
}: {
  value: number | null | undefined;
  max?: number;
  tone?: 'accent' | 'home' | 'muted';
  showZero?: boolean;
}) {
  const v = value ?? 0;
  const w = max > 0 ? Math.min(100, (v / max) * 100) : 0;
  return (
    <div className="probwrap">
      <span className="probbar">
        <span className={`fill ${tone}`} style={{ width: `${w}%` }} />
      </span>
      <span className="probval">{v <= 0 && !showZero ? '–' : `${pct(v)}%`}</span>
    </div>
  );
}
