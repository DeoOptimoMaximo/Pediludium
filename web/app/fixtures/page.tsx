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

  return (
    <>
      <RealtimeRefresh table="match" />
      <h1 style={{ marginTop: 28 }}>{t.fixtures.title}</h1>
      <p className="muted">{t.fixtures.sub(matches.length)}</p>

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
