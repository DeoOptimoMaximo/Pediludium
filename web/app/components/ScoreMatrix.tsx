import { cellRegion, dcScoreMatrix, outcomeProbs } from '@/lib/dcmath';

/**
 * Server-rendered SVG heatmap of the Dixon-Coles scoreline matrix P(home i, away j).
 * Cells are tinted by outcome region (home win / draw / away win) with opacity ∝ probability,
 * so the eye sees instantly that the DRAW is a single thin diagonal while the two WIN regions
 * are whole triangles. This is the centrepiece of the "why no draw" blog post — mermaid can't
 * draw heatmaps, so it is hand-built SVG, computed live from λ, μ, ρ (the real model math).
 */
const REGION_COLOR = {
  home: 'var(--home)',
  draw: 'var(--draw)',
  away: 'var(--away)',
} as const;

export function ScoreMatrix({
  lambda,
  mu,
  rho = -0.012,
  max = 6,
  homeLabel = '1',
  awayLabel = '2',
}: {
  lambda: number;
  mu: number;
  rho?: number;
  max?: number;
  homeLabel?: string;
  awayLabel?: string;
}) {
  const full = dcScoreMatrix(lambda, mu, rho, 8);
  const out = outcomeProbs(full); // computed on the full matrix for accuracy
  const m = full.slice(0, max + 1).map((row) => row.slice(0, max + 1));
  const peak = Math.max(...m.flat());

  const cell = 38;
  const pad = 26;
  const size = pad + (max + 1) * cell;

  return (
    <div className="scmx">
      <svg viewBox={`0 0 ${size} ${size}`} className="scmx-svg" role="img" aria-label="Dixon-Coles scoreline matrix">
        {/* axis captions */}
        <text x={pad + ((max + 1) * cell) / 2} y={12} className="scmx-axis" textAnchor="middle">
          golovi gosta →
        </text>
        <text
          x={12}
          y={pad + ((max + 1) * cell) / 2}
          className="scmx-axis"
          textAnchor="middle"
          transform={`rotate(-90 12 ${pad + ((max + 1) * cell) / 2})`}
        >
          golovi domaćina →
        </text>
        {m.map((row, i) =>
          row.map((p, j) => {
            const region = cellRegion(i, j);
            const x = pad + j * cell;
            const y = pad + i * cell;
            const op = peak > 0 ? 0.12 + 0.88 * (p / peak) : 0;
            return (
              <g key={`${i}-${j}`}>
                <rect
                  x={x + 1}
                  y={y + 1}
                  width={cell - 2}
                  height={cell - 2}
                  rx={4}
                  fill={REGION_COLOR[region]}
                  fillOpacity={op}
                  stroke={region === 'draw' ? 'var(--text)' : 'none'}
                  strokeOpacity={region === 'draw' ? 0.35 : 0}
                />
                <text x={x + cell / 2} y={y + cell / 2 + 3} className="scmx-num" textAnchor="middle">
                  {(p * 100).toFixed(p >= 0.1 ? 0 : 1)}
                </text>
              </g>
            );
          }),
        )}
      </svg>
      <div className="scmx-legend">
        <span>
          <i style={{ background: 'var(--home)' }} /> {homeLabel} {Math.round(out.pHome * 100)}%
        </span>
        <span>
          <i style={{ background: 'var(--draw)', outline: '1px solid var(--text)' }} /> X (dijagonala){' '}
          {Math.round(out.pDraw * 100)}%
        </span>
        <span>
          <i style={{ background: 'var(--away)' }} /> {awayLabel} {Math.round(out.pAway * 100)}%
        </span>
      </div>
    </div>
  );
}
