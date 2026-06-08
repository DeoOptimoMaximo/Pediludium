import Link from 'next/link';
import { getMatches, getPredictions } from '@/lib/data';
import { fmtDay } from '@/lib/format';
import { PRED_MODELS } from '@/lib/types';
import { PredictionBar } from '../components/PredictionBar';
import { TeamInline } from '../components/TeamInline';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function PredictionsPage({
  searchParams,
}: {
  searchParams: Promise<{ model?: string }>;
}) {
  const { model: modelParam } = await searchParams;
  const modelKey = modelParam === 'baseline' ? 'baseline' : 'dc';
  const model = PRED_MODELS[modelKey];

  const [matches, preds] = await Promise.all([getMatches(), getPredictions(model.version)]);
  // group-stage fixtures (real teams); knockout uses placeholders until decided
  const fixtures = matches.filter((m) => m.group_name && preds.has(m.ss_id));

  return (
    <>
      <RealtimeRefresh table="prediction" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 28, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Predictions</h1>
        <span style={{ flex: 1 }} />
        <div className="toggle">
          <Link href="/predictions?model=dc" className={modelKey === 'dc' ? 'on' : ''}>
            Dixon-Coles
          </Link>
          <Link href="/predictions?model=baseline" className={modelKey === 'baseline' ? 'on' : ''}>
            Elo + Poisson
          </Link>
        </div>
      </div>
      <p className="muted">
        <b>{model.label}</b> model · {fixtures.length} group-stage fixtures ·{' '}
        <code className="small">{model.version}</code>
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
        <b>Dixon-Coles</b> (low-score correction + exponential time-decay weighting, fitted by
        weighted MLE) is now live alongside the Elo + Poisson baseline — switch above. Both feed a{' '}
        <Link href="/simulation" className="teamlink"><b>Monte-Carlo tournament simulation</b></Link>{' '}
        for group-advance &amp; title odds. Still on the roadmap: opponent-strength/confederation
        weighting, xG-based goal rates, and a market-odds blend. See{' '}
        <code>docs/08-prediction-roadmap.md</code>.
      </div>
    </>
  );
}
