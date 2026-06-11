import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client (anon key + RLS public-read). The web app NEVER calls the upstream source —
 * it reads only from our DB, which the home fetcher fills (docs/04 golden rule).
 */
export function supa() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}
