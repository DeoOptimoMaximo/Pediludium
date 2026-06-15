import Link from 'next/link';
import { getMatches, getPredictions } from '@/lib/data';
import { dayKey, fmtDay } from '@/lib/format';
import { getDict } from '@/lib/lang';
import type { WcMatch } from '@/lib/types';
import { MatchRow } from '../components/MatchRow';
import { RealtimeRefresh } from '../components/RealtimeRefresh';

export const dynamic = 'force-dynamic';

export default async function FixturesPage() {
  const [{ lang, t }, matches, preds] = await Promise.all([getDict(), getMatches(), getPredictions()]);

  const byDay = new Map<string, WcMatch[]>();
  for (const m of matches) {
    const k = dayKey(m.start_ts);
    (byDay.get(k) ?? byDay.set(k, []).get(k)!).push(m);
  }

  // Running scoreboard across finished matches: how many 1-X-2 outcomes the frozen
  // pre-match prediction actually called. Each row also shows its own ✓/✗ verdict.
  let scored = 0;
  let hits = 0;
  for (const m of matches) {
    if (m.status_type !== 'finished' || m.home_score == null || m.away_score == null) continue;
    const p = preds.get(m.ss_id);
    if (!p || p.p_home == null || p.p_draw == null || p.p_away == null) continue;
    scored++;
    const pick = [p.p_home, p.p_draw, p.p_away].indexOf(Math.max(p.p_home, p.p_draw, p.p_away));
    const actual = m.home_score > m.away_score ? 0 : m.home_score === m.away_score ? 1 : 2;
    if (pick === actual) hits++;
  }

  return (
    <>
      <RealtimeRefresh table="match" />
      <h1 style={{ marginTop: 28 }}>{t.fixtures.title}</h1>
      <p className="muted">{t.fixtures.sub(matches.length)}</p>
      {scored > 0 && (
        <p className="muted small" style={{ marginTop: -6 }}>
          <span className="vchip ok" style={{ marginRight: 8 }}>
            ✓ {Math.round((hits / scored) * 100)}%
          </span>
          {t.scorecard.hits(hits, scored, Math.round((hits / scored) * 100))} ·{' '}
          <Link href="/accuracy" className="link">
            {t.nav.accuracy}
          </Link>
        </p>
      )}

      {[...byDay.entries()].map(([day, ms]) => (
        <div key={day}>
          <div className="dayhdr">
            <h3>{day === 'TBD' ? t.common.dateTbd : fmtDay(ms[0].start_ts, lang)}</h3>
            <span className="muted small">{ms.length}</span>
            <span className="ln" />
          </div>
          <div className="card" style={{ padding: '6px 14px' }}>
            {ms.map((m) => (
              <MatchRow key={m.ss_id} m={m} p={preds.get(m.ss_id)} lang={lang} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
