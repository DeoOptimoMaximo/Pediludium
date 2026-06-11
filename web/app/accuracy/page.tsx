import Link from 'next/link';
import { getCalibration, getMatches } from '@/lib/data';
import { fmtDay } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import { PRED_MODELS, type CalibRow } from '@/lib/types';
import { SeriesChart } from '../components/SeriesChart';

export const dynamic = 'force-dynamic';

const NAIVE_BRIER = 2 / 3; // uniform ⅓-⅓-⅓ guess
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Model backtesting — every prediction is frozen at the last snapshot before
 * kick-off and scored (multiclass Brier + log-loss) once the match finishes.
 * Lower is better; the uniform-guess baseline (0.667 / 1.099) is the bar a
 * model must beat to claim it knows anything at all.
 */
export default async function AccuracyPage() {
  const [{ lang, t }, calib, matches] = await Promise.all([getDict(), getCalibration(), getMatches()]);
  const byId = new Map(matches.map((m) => [m.ss_id, m]));
  const models = [PRED_MODELS.dc, PRED_MODELS.baseline].filter((pm) => calib[pm.version]?.length);

  const label = (r: CalibRow) => {
    const m = byId.get(r.match_id);
    if (!m) return `#${r.match_id}`;
    const h = teamName(m.home_name, m.home_alpha2, lang) ?? m.home_short ?? '?';
    const a = teamName(m.away_name, m.away_alpha2, lang) ?? m.away_short ?? '?';
    const score = m.home_score != null ? ` ${m.home_score}–${m.away_score}` : '';
    return `${h}–${a}${score}`;
  };

  return (
    <>
      <h1 style={{ marginTop: 28 }}>{t.accuracy.title}</h1>
      <p className="muted" style={{ maxWidth: 640 }}>{t.accuracy.sub}</p>

      {models.length === 0 ? (
        <div className="note" style={{ marginTop: 8 }}>{t.accuracy.empty}</div>
      ) : (
        <>
          <div className="card" style={{ padding: '6px 14px' }}>
            <div className="tblwrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>{t.accuracy.summary.model}</th>
                    <th>{t.accuracy.summary.matches}</th>
                    <th>{t.accuracy.summary.brier}</th>
                    <th>{t.accuracy.summary.logloss}</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((pm) => {
                    const rows = calib[pm.version]!;
                    return (
                      <tr key={pm.key}>
                        <td className="name"><b>{pm.label}</b></td>
                        <td className="num">{rows.length}</td>
                        <td className="num">
                          <b>{mean(rows.map((r) => r.brier)).toFixed(3)}</b>{' '}
                          <span className="muted small">({t.accuracy.summary.naive} 0.667)</span>
                        </td>
                        <td className="num">
                          <b>{mean(rows.map((r) => r.logloss)).toFixed(3)}</b>{' '}
                          <span className="muted small">({t.accuracy.summary.naive} 1.099)</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {models.some((pm) => calib[pm.version]!.length >= 2) && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2>{t.accuracy.chartTitle}</h2>
              <p className="small muted" style={{ marginTop: -2 }}>{t.accuracy.chartNote}</p>
              <SeriesChart
                lines={[
                  {
                    label: t.accuracy.summary.naive,
                    color: 'var(--draw)',
                    dashed: true,
                    points: cumBrier(calib[models[0]!.version]!).map(([x]) => [x, NAIVE_BRIER] as [number, number]),
                  },
                  ...models.map((pm, i) => ({
                    label: pm.label,
                    color: i === 0 ? 'var(--accent)' : 'var(--home)',
                    points: cumBrier(calib[pm.version]!),
                  })),
                ]}
                yMax={1}
                yLabel="Brier 0–1"
              />
            </div>
          )}

          {models.map((pm) => (
            <div key={pm.key}>
              <div className="dayhdr">
                <h3>{t.accuracy.perMatch} · {pm.label}</h3>
                <span className="ln" />
              </div>
              <div className="card" style={{ padding: '6px 14px' }}>
                <div className="tblwrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>{t.accuracy.th.date}</th>
                        <th style={{ textAlign: 'left' }}>{t.accuracy.th.match}</th>
                        <th>{t.accuracy.th.pred}</th>
                        <th>{t.accuracy.th.outcome}</th>
                        <th>{t.accuracy.th.brier}</th>
                        <th>{t.accuracy.th.logloss}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calib[pm.version]!.map((r) => (
                        <tr key={r.match_id}>
                          <td className="name muted small">{fmtDay(r.kickoff, lang)}</td>
                          <td className="name">
                            <Link href={`/match/${r.match_id}`} className="teamlink">{label(r)}</Link>
                          </td>
                          <td className="num">
                            {Math.round(r.p[0] * 100)}–{Math.round(r.p[1] * 100)}–{Math.round(r.p[2] * 100)}
                          </td>
                          <td>{t.accuracy.outcomeName(r.outcome)}</td>
                          <td className="num">{r.brier.toFixed(3)}</td>
                          <td className="num">{r.logloss.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <p className="note" style={{ marginTop: 18 }}>{t.accuracy.explainer}</p>
    </>
  );
}

/** [kickoff_epoch, running mean Brier] after each scored match. */
function cumBrier(rows: CalibRow[]): [number, number][] {
  let sum = 0;
  return rows.map((r, i) => {
    sum += r.brier;
    return [Math.floor(new Date(r.kickoff).getTime() / 1000), sum / (i + 1)];
  });
}
