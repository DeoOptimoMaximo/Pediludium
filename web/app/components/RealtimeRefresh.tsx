'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supa } from '@/lib/supabase';

/**
 * Drop-in end-to-end realtime: subscribes to Postgres changes on `table` (optionally
 * filtered, e.g. `team_id=eq.4715`) and calls router.refresh() on any insert/update/delete.
 * router.refresh() re-runs the server component and refetches from the DB in place — so the
 * moment the fetcher upserts new data, the open page updates with NO full reload.
 */
export function RealtimeRefresh({
  table,
  filter,
  channel,
}: {
  table: string;
  filter?: string;
  channel?: string;
}) {
  const router = useRouter();
  useEffect(() => {
    // snapshot builds (public Cloudflare deploy) have no Supabase Realtime to subscribe to
    if (process.env.NEXT_PUBLIC_DATA_SOURCE === 'snapshot') return;
    const client = supa();
    const ch = client
      .channel(channel ?? `rt-${table}-${filter ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      client.removeChannel(ch);
    };
  }, [table, filter, channel, router]);
  return null;
}
