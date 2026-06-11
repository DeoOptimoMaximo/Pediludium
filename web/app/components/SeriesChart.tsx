/**
 * Minimal server-rendered SVG time-series chart (no client JS, no chart lib).
 * Points are change-points from the hourly snapshot history, so lines render as
 * step-after: a value holds until the model actually changed its mind. The last
 * value is extended to the right edge (kickoff / latest snapshot).
 */

export interface SeriesLine {
  label: string;
  /** any CSS color, e.g. 'var(--home)' */
  color: string;
  /** [epoch_seconds, value] — chronological */
  points: [number, number][];
  dashed?: boolean;
}

const W = 100;
const H = 40;
const PAD = 2;

function stepPath(pts: [number, number][], xMin: number, xMax: number, yMax: number): string {
  const sx = (t: number) => (xMax === xMin ? 0 : ((t - xMin) / (xMax - xMin)) * W);
  const sy = (v: number) => H - PAD - (Math.min(v, yMax) / yMax) * (H - 2 * PAD);
  let d = '';
  pts.forEach(([t, v], i) => {
    const x = sx(t);
    const y = sy(v);
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` H ${x.toFixed(2)} V ${y.toFixed(2)}`;
  });
  return d + ` H ${W}`; // hold the latest value to the right edge
}

export function SeriesChart({
  lines,
  xMax,
  yMax = 1,
  xLabels,
  yLabel,
}: {
  lines: SeriesLine[];
  /** right edge (epoch seconds) — e.g. kickoff; defaults to the latest point */
  xMax?: number;
  /** top of the y scale (probability) */
  yMax?: number;
  /** [left, right] labels under the x axis */
  xLabels?: [string, string];
  /** small scale hint, e.g. '0–100%' */
  yLabel?: string;
}) {
  const ts = lines.flatMap((l) => l.points.map((p) => p[0]));
  if (ts.length === 0) return null;
  const x0 = Math.min(...ts);
  const x1 = Math.max(xMax ?? 0, ...ts);

  return (
    <div className="serieschart">
      {yLabel && <span className="ylab">{yLabel}</span>}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={W} y1={H - PAD - g * (H - 2 * PAD)} y2={H - PAD - g * (H - 2 * PAD)} className="grid" />
        ))}
        {lines.map((l) =>
          l.points.length === 0 ? null : (
            <path
              key={l.label}
              d={stepPath(l.points, x0, x1, yMax)}
              fill="none"
              stroke={l.color}
              strokeWidth={1.6}
              strokeDasharray={l.dashed ? '3 2.4' : undefined}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          ),
        )}
      </svg>
      {xLabels && (
        <div className="xlabs">
          <span>{xLabels[0]}</span>
          <span>{xLabels[1]}</span>
        </div>
      )}
      <div className="legend">
        {lines.map((l) => {
          const last = l.points[l.points.length - 1];
          return (
            <span key={l.label} className="li">
              <i style={{ background: l.color }} />
              {l.label}
              {last && <b>{(last[1] * 100).toFixed(last[1] < 0.1 ? 1 : 0)}%</b>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
