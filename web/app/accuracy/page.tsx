import Link from 'next/link';
import { getCalibration, getMatches, getReport } from '@/lib/data';
import { fmtDay } from '@/lib/format';
import { teamName } from '@/lib/i18n';
import { getDict } from '@/lib/lang';
import { PRED_MODELS, type CalibRow, type FinalReport, type WcMatch } from '@/lib/types';
import { ReliabilityChart } from '../components/ReliabilityChart';
import { SeriesChart } from '../components/SeriesChart';

export const dynamic = 'force-dynamic';

const NAIVE_BRIER = 2 / 3; // uniform ⅓-⅓-⅓ guess
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Visual divergence between the prediction and what actually happened, driven by the
 * probability the model gave to the real outcome (pActual): high → the result was expected
 * (green), low → a surprise the model didn't see coming (red). Returns a light row tint, a
 * stronger left-edge, and a chip background — all alpha-blended so they read on both themes.
 */
function tintFor(pActual: number): { row: string; edge: string; chip: string } {
  const h = Math.round(Math.max(0, Math.min(1, pActual)) * 130); // 0 = red, 130 = green
  return {
    row: `hsl(${h} 70% 50% / 0.12)`,
    edge: `hsl(${h} 60% 45% / 0.85)`,
    chip: `hsl(${h} 75% 50% / 0.22)`,
  };
}

/**
 * Model backtesting — every prediction is frozen at the last snapshot before
 * kick-off and scored (multiclass Brier + log-loss) once the match finishes.
 * Lower is better; the uniform-guess baseline (0.667 / 1.099) is the bar a
 * model must beat to claim it knows anything at all.
 */
export default async function AccuracyPage() {
  const [{ lang, t }, calib, matches, report] = await Promise.all([
    getDict(),
    getCalibration(),
    getMatches(),
    getReport(),
  ]);
  const byId = new Map(matches.map((m) => [m.ss_id, m]));
  const models = [PRED_MODELS.dc, PRED_MODELS.baseline].filter((pm) => calib[pm.version]?.length);

  const matchLabel = (m: WcMatch | undefined, id: number) => {
    if (!m) return `#${id}`;
    const h = teamName(m.home_name, m.home_alpha2, lang) ?? m.home_short ?? '?';
    const a = teamName(m.away_name, m.away_alpha2, lang) ?? m.away_short ?? '?';
    const score = m.home_score != null ? ` ${m.home_score}–${m.away_score}` : '';
    return `${h}–${a}${score}`;
  };
  const label = (r: CalibRow) => matchLabel(byId.get(r.match_id), r.match_id);

  return (
    <>
      <h1 style={{ marginTop: 28 }}>{t.accuracy.title}</h1>
      <p className="muted" style={{ maxWidth: 640 }}>{t.accuracy.sub}</p>

      {/* Once every match is played the running tally stops being the story — the final
          reckoning leads, and the per-match scorecard below becomes the supporting detail. */}
      {report?.complete && <FinalReckoning report={report} t={t} byId={byId} matchLabel={matchLabel} lang={lang} />}

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

          <p className="small muted" style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 64,
                height: 12,
                borderRadius: 6,
                background: `linear-gradient(90deg, ${tintFor(0).edge}, ${tintFor(0.5).edge}, ${tintFor(1).edge})`,
                flexShrink: 0,
              }}
            />
            {t.accuracy.surpriseNote}
          </p>

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
                        <th title={t.accuracy.surpriseNote}>{t.accuracy.th.surprise}</th>
                        <th>{t.accuracy.th.brier}</th>
                        <th>{t.accuracy.th.logloss}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calib[pm.version]!.map((r) => {
                        const pActual = r.p[r.outcome] ?? 0;
                        const tint = tintFor(pActual);
                        return (
                          <tr key={r.match_id} style={{ background: tint.row }}>
                            <td
                              className="name muted small"
                              style={{ borderLeft: `3px solid ${tint.edge}` }}
                            >
                              {fmtDay(r.kickoff, lang)}
                            </td>
                            <td className="name">
                              <Link href={`/match/${r.match_id}`} className="teamlink">{label(r)}</Link>
                            </td>
                            <td className="num">
                              {Math.round(r.p[0] * 100)}–{Math.round(r.p[1] * 100)}–{Math.round(r.p[2] * 100)}
                            </td>
                            <td>{t.accuracy.outcomeName(r.outcome)}</td>
                            <td className="num">
                              <span
                                className="chip"
                                style={{ background: tint.chip, borderColor: tint.edge, fontWeight: 700, color: 'var(--text)' }}
                                title={t.accuracy.surpriseNote}
                              >
                                {Math.round(pActual * 100)}%
                              </span>
                            </td>
                            <td className="num">{r.brier.toFixed(3)}</td>
                            <td className="num">{r.logloss.toFixed(3)}</td>
                          </tr>
                        );
                      })}
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

/** Human label for a model_version, falling back to the raw version for anything unregistered. */
function modelLabel(version: string): string {
  return Object.values(PRED_MODELS).find((pm) => pm.version === version)?.label ?? version;
}

/**
 * The end-of-tournament report (docs/21 §3A). Deliberately ordered so the honest numbers
 * come before the flattering ones: the headline table carries every model's own n, the
 * like-for-like subset follows immediately (it is the only ranking that means anything),
 * and the caveats are a section rather than a footnote.
 */
function FinalReckoning({
  report,
  t,
  byId,
  matchLabel,
  lang,
}: {
  report: FinalReport;
  t: Awaited<ReturnType<typeof getDict>>['t'];
  byId: Map<number, WcMatch>;
  matchLabel: (m: WcMatch | undefined, id: number) => string;
  lang: 'hr' | 'en';
}) {
  const r = t.accuracy.report;
  // the report's own ranking is by Brier; the headline model for charts is the best of ours
  const headline = report.models.find((m) => m.version !== PRED_MODELS.market.version) ?? report.models[0];

  const fmt = (v: number) => v.toFixed(3);

  return (
    <section style={{ marginTop: 22 }}>
      <div className="dayhdr">
        <h2 style={{ margin: 0 }}>{r.title}</h2>
        <span className="ln" />
      </div>
      <p className="muted" style={{ maxWidth: 700 }}>{r.sub(report.season.played)}</p>

      <div className="card" style={{ padding: '6px 14px' }}>
        <div className="tblwrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{r.th.model}</th>
                <th>{r.th.n}</th>
                <th>{r.th.brier}</th>
                <th>{r.th.logloss}</th>
                <th>{r.th.skill}</th>
                <th>{r.th.group}</th>
                <th>{r.th.ko}</th>
              </tr>
            </thead>
            <tbody>
              {report.models.map((m) => (
                <tr key={m.version}>
                  <td className="name"><b>{modelLabel(m.version)}</b></td>
                  <td className="num">{m.overall.n}</td>
                  <td className="num"><b>{fmt(m.overall.brier)}</b></td>
                  <td className="num">{fmt(m.overall.logloss)}</td>
                  <td className="num">{m.skill >= 0 ? '+' : ''}{m.skill.toFixed(3)}</td>
                  <td className="num">{m.group ? `${fmt(m.group.brier)} (${m.group.n})` : '—'}</td>
                  <td className="num">{m.ko ? `${fmt(m.ko.brier)} (${m.ko.n})` : '—'}</td>
                </tr>
              ))}
              <tr className="muted">
                <td className="name">{t.accuracy.summary.naive}</td>
                <td className="num">{report.naive.n}</td>
                <td className="num">{fmt(report.naive.brier)}</td>
                <td className="num">{fmt(report.naive.logloss)}</td>
                <td className="num">0.000</td>
                <td className="num">—</td>
                <td className="num">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted" style={{ maxWidth: 700 }}>{r.skillNote}</p>

      {report.common && <SubsetTable title={r.commonTitle} note={r.commonNote(report.common.n)} subset={report.common} t={t} />}
      {report.vsMarket && <SubsetTable title={r.marketTitle} note={r.marketNote(report.vsMarket.n)} subset={report.vsMarket} t={t} />}

      {headline && headline.reliability.length > 0 && (
        <>
          <div className="dayhdr"><h3>{r.relTitle}</h3><span className="ln" /></div>
          <p className="small muted" style={{ maxWidth: 700 }}>{r.relNote}</p>
          <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
            <div style={{ maxWidth: 340, width: '100%' }}>
              <ReliabilityChart
                bins={headline.reliability}
                label={r.relCaption(modelLabel(headline.version))}
                axisPredicted={r.relPredicted}
                axisObserved={r.relObserved}
              />
            </div>
          </div>
        </>
      )}

      {headline && headline.surprises.length > 0 && (
        <>
          <div className="dayhdr"><h3>{r.surprisesTitle}</h3><span className="ln" /></div>
          <p className="small muted" style={{ maxWidth: 700 }}>{r.surprisesNote}</p>
          <div className="card" style={{ padding: '6px 14px' }}>
            <div className="tblwrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>{t.accuracy.th.date}</th>
                    <th style={{ textAlign: 'left' }}>{t.accuracy.th.match}</th>
                    <th>{t.accuracy.th.outcome}</th>
                    <th>{t.accuracy.th.surprise}</th>
                  </tr>
                </thead>
                <tbody>
                  {headline.surprises.map((s) => {
                    const tint = tintFor(s.p_actual);
                    return (
                      <tr key={s.match_id} style={{ background: tint.row }}>
                        <td className="name muted small" style={{ borderLeft: `3px solid ${tint.edge}` }}>
                          {fmtDay(s.kickoff, lang)}
                        </td>
                        <td className="name">
                          <Link href={`/match/${s.match_id}`} className="teamlink">
                            {matchLabel(byId.get(s.match_id), s.match_id)}
                          </Link>
                        </td>
                        <td>{t.accuracy.outcomeName(s.outcome)}</td>
                        <td className="num">
                          <span className="chip" style={{ background: tint.chip, borderColor: tint.edge, fontWeight: 700, color: 'var(--text)' }}>
                            {Math.round(s.p_actual * 100)}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="dayhdr"><h3>{r.caveatsTitle}</h3><span className="ln" /></div>
      <div className="note">
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
          {r.caveats.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>
    </section>
  );
}

/** One like-for-like comparison: every model re-scored on the same set of matches. */
function SubsetTable({
  title,
  note,
  subset,
  t,
}: {
  title: string;
  note: string;
  subset: NonNullable<FinalReport['common']>;
  t: Awaited<ReturnType<typeof getDict>>['t'];
}) {
  const rows = Object.entries(subset.brier).sort((a, b) => a[1] - b[1]);
  return (
    <>
      <div className="dayhdr"><h3>{title}</h3><span className="ln" /></div>
      <p className="small muted" style={{ maxWidth: 700 }}>{note}</p>
      <div className="card" style={{ padding: '6px 14px' }}>
        <div className="tblwrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>{t.accuracy.report.th.model}</th>
                <th>{t.accuracy.report.th.n}</th>
                <th>{t.accuracy.report.th.brier}</th>
                <th>{t.accuracy.report.th.logloss}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([version, brier]) => (
                <tr key={version}>
                  <td className="name"><b>{modelLabel(version)}</b></td>
                  <td className="num">{subset.n}</td>
                  <td className="num"><b>{brier.toFixed(3)}</b></td>
                  <td className="num">{(subset.logloss[version] ?? 0).toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
