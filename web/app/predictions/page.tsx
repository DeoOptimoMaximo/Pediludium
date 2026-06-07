import Link from 'next/link';
import { getMatches, getPredictions } from '@/lib/data';
import { fmtDay } from '@/lib/format';
import { PredictionBar } from '../components/PredictionBar';
import { TeamInline } from '../components/TeamInline';

export const dynamic = 'force-dynamic';

export default async function PredictionsPage() {
  const [matches, preds] = await Promise.all([getMatches(), getPredictions()]);
  // group-stage fixtures (real teams); knockout uses placeholders until decided
  const fixtures = matches.filter((m) => m.group_name && preds.has(m.ss_id));

  return (
    <>
      <h1 style={{ marginTop: 28 }}>Predictions</h1>
      <p className="muted">
        Baseline <b>Elo + Poisson</b> model · {fixtures.length} group-stage fixtures
      </p>

      <div className="card" style={{ padding: '4px 16px' }}>
        {fixtures.map((m) => {
          const p = preds.get(m.ss_id)!;
          return (
            <Link key={m.ss_id} href={`/match/${m.ss_id}`} style={{ display: 'block' }}>
              <div style={{ padding: '14px 0', borderTop: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span className="chip group">{m.group_name}</span>
                  <span className="muted small">{fmtDay(m.start_ts)}</span>
                  <span style={{ flex: 1 }} />
                  <span className="muted small">
                    xG {p.exp_home_goals?.toFixed(2)} – {p.exp_away_goals?.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <TeamInline name={m.home_name} short={m.home_short} alpha2={m.home_alpha2} align="right" />
                  </div>
                  <span className="vs">v</span>
                  <TeamInline name={m.away_name} short={m.away_short} alpha2={m.away_alpha2} />
                </div>
                <PredictionBar p={p} />
              </div>
            </Link>
          );
        })}
      </div>

      <div className="note" style={{ marginTop: 18 }}>
        <b className="chip tbd">TODO / TBD</b> &nbsp;Advanced prediction is planned: Dixon-Coles
        (low-score + time-decay), xG-based goal rates, market-odds blend, Bayesian hierarchical
        strengths, and a Monte-Carlo tournament simulation for group-advance & win-cup
        probabilities. New models will appear here side-by-side (the schema versions predictions).
        See <code>docs/08-prediction-roadmap.md</code>.
      </div>
    </>
  );
}
