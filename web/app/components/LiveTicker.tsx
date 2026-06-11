'use client';
import { useEffect, useState } from 'react';
import { supa } from '@/lib/supabase';
import { T, type Lang } from '@/lib/i18n';

/**
 * "Live now" pill. In snapshot builds (public deploy) there is no Realtime — the server
 * passes the live count from the published snapshot and the subscription is skipped;
 * in dev it subscribes to Postgres changes on `match` and re-queries the live count.
 */
export function LiveTicker({ lang, staticCount }: { lang: Lang; staticCount?: number }) {
  const [live, setLive] = useState<number | null>(staticCount ?? null);
  const t = T[lang].ticker;

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DATA_SOURCE === 'snapshot') return;
    const client = supa();
    let active = true;
    const load = async () => {
      const { count } = await client
        .from('match')
        .select('*', { count: 'exact', head: true })
        .eq('status_type', 'inprogress');
      if (active) setLive(count ?? 0);
    };
    load();
    const ch = client
      .channel('match-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match' }, load)
      .subscribe();
    return () => {
      active = false;
      client.removeChannel(ch);
    };
  }, []);

  if (live === null) return <span className="chip">{t.connecting}</span>;
  if (live === 0) return <span className="chip">{t.none}</span>;
  return <span className="chip live">{t.live(live)}</span>;
}
