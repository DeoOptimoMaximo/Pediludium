import type { ReliabilityBin } from '@/lib/types';

/**
 * Server-rendered reliability diagram — the honest test of a probabilistic model.
 *
 * Every prediction contributes three one-vs-rest legs (home / draw / away). Legs are
 * bucketed by the probability the model gave them, and each bucket is plotted as
 * (mean forecast, observed frequency). A perfectly calibrated model sits on the
 * diagonal: when it says 30%, it happens 30% of the time. Above the line = the model
 * was too cautious, below = it was overconfident.
 *
 * Dot area is proportional to the number of legs in the bucket, because that is the
 * whole story at 104 matches — a point far off the diagonal backed by 3 legs is noise,
 * and drawing it the same size as one backed by 239 would be a lie of emphasis.
 */
export function ReliabilityChart({
  bins,
  label,
  axisPredicted,
  axisObserved,
}: {
  bins: ReliabilityBin[];
  label: string;
  axisPredicted: string;
  axisObserved: string;
}) {
  const size = 260;
  const pad = 34;
  const plot = size - pad - 12;

  const x = (p: number) => pad + p * plot;
  const y = (p: number) => pad + (1 - p) * plot; // SVG y grows downward

  const maxN = Math.max(...bins.map((b) => b.n), 1);
  // area ∝ n, so radius ∝ √n; floor keeps a 3-leg bucket visible without shouting
  const radius = (n: number) => 3 + 9 * Math.sqrt(n / maxN);

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure className="relc">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} style={{ width: '100%', height: 'auto' }}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={x(tk)} y1={y(0)} x2={x(tk)} y2={y(1)} stroke="var(--line)" strokeWidth={0.5} />
            <line x1={x(0)} y1={y(tk)} x2={x(1)} y2={y(tk)} stroke="var(--line)" strokeWidth={0.5} />
            <text x={x(tk)} y={size - 6} textAnchor="middle" fontSize={8} fill="var(--muted)">
              {Math.round(tk * 100)}
            </text>
            <text x={pad - 6} y={y(tk) + 3} textAnchor="end" fontSize={8} fill="var(--muted)">
              {Math.round(tk * 100)}
            </text>
          </g>
        ))}

        {/* the diagonal a perfectly calibrated model would trace */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 3" />

        {bins.map((b) => (
          <circle
            key={b.lo}
            cx={x(b.predicted)}
            cy={y(b.observed)}
            r={radius(b.n)}
            fill="var(--accent)"
            fillOpacity={0.45}
            stroke="var(--accent)"
            strokeWidth={1.2}
          >
            <title>{`${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}% · n=${b.n} · ${axisPredicted} ${Math.round(b.predicted * 100)}% → ${axisObserved} ${Math.round(b.observed * 100)}%`}</title>
          </circle>
        ))}

        <text x={pad + plot / 2} y={size - 20} textAnchor="middle" fontSize={9} fill="var(--muted)">
          {axisPredicted}
        </text>
        <text
          x={11}
          y={pad + plot / 2}
          textAnchor="middle"
          fontSize={9}
          fill="var(--muted)"
          transform={`rotate(-90 11 ${pad + plot / 2})`}
        >
          {axisObserved}
        </text>
      </svg>
      <figcaption className="small muted">{label}</figcaption>
    </figure>
  );
}
