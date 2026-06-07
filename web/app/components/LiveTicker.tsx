'use client';
import { useEffect, useState } from 'react';
import { supa } from '@/lib/supabase';

/**
 * Realtime "live now" pill — subscribes to Postgres changes on `match`.
 * Proves the realtime pipe end-to-end; when the fetcher upserts a live score,
 * Supabase Realtime pushes the change and this re-queries the live count.
 */
export function LiveTicker() {
  const [live, setLive] = useState<number | null>(null);

  useEffect(() => {
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
