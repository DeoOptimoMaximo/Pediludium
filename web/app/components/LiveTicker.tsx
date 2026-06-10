'use client';
import { useEffect, useState } from 'react';
import { supa } from '@/lib/supabase';

/**
 * Realtime "live now" pill — subscribes to Postgres changes on `match`.
 * Proves the realtime pipe end-to-end; when the fetcher upserts a live score,
 * Supabase Realtime pushes the change and this re-queries the live count.
 */
/**
 * In snapshot builds there is no Realtime — the server passes the live count from the
 * published snapshot instead and the subscription is skipped.
 */
export function LiveTicker({ staticCount }: { staticCount?: number }) {
  const [live, setLive] = useState<number | null>(staticCount ?? null);

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

  if (live === null) return <span className="chip">connecting…</span>;
  if (live === 0) return <span className="chip">no matches live</span>;
  return <span className="chip live">● {live} live now</span>;
}
