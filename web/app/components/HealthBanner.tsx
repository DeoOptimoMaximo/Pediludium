import { getHealth } from '@/lib/data';
import { T, type Lang } from '@/lib/i18n';

/**
 * A discreet strip shown only when the published data is knowingly behind (docs/21 §2A).
 *
 * The point is editorial, not decorative. This site's whole claim is that its predictions are
 * verifiable — and during the 2026-07 outage it served a nine-day-old scorecard, complete with an
 * unplayed final, while looking perfectly healthy. Silently stale data is worse than visibly
 * stale data. If we know we are behind, we say so.
 *
 * Only `stranded` drives it: that check means "matches have been played whose results we do not
 * have", which is exactly the visitor-facing failure. Internal reds (DB unreachable, ingest
 * stalled) are the operator's problem via ntfy and say nothing about what the visitor is seeing —
 * a finished, archived tournament is not stale just because nothing is fetching any more.
 */
export async function HealthBanner({ lang }: { lang: Lang }) {
  const health = await getHealth().catch(() => null);
  if (!health) return null;

  const stranded = health.checks.find((c) => c.id === 'stranded');
  if (!stranded || stranded.level === 'ok') return null;

  const t = T[lang].health;
  const count = Number((stranded.detail?.count as number | undefined) ?? 0);
  return (
    <div className="health-banner" role="status">
      <span aria-hidden="true">⏳</span> {t.stale(count, new Date(health.generated_at))}
    </div>
  );
}
