import { getCloudflareContext } from '@opennextjs/cloudflare';
import type {
  EdgeOpportunity,
  EdgePaperOrder,
  EdgeStats,
  EdgeWallet,
  MatchOddsBoard,
  PmQuoteInfo,
} from './edge-types';

/**
 * Snapshot-backed edge reads for the public Cloudflare deploy. Reads one Workers KV key
 * `edge`, published by the fetcher's `npm run snapshot` (export-snapshot.ts → exportEdge).
 * Same signatures as edge-supabase.ts; lib/edge.ts picks the implementation. If the key
 * isn't published yet, everything returns empty (the page shows zeros, never errors).
 */

interface EdgeBlob {
  generated_at: string;
  stats: EdgeStats;
  wallet: EdgeWallet | null;
  opportunities: EdgeOpportunity[];
  orders: EdgePaperOrder[];
  board: MatchOddsBoard[];
  pm: Record<string, PmQuoteInfo>;
  names: Record<string, { home: string; away: string }>;
}

const EMPTY: EdgeBlob = {
  generated_at: '',
  stats: { quotes: 0, venues: 0 },
  wallet: null,
  opportunities: [],
  orders: [],
  board: [],
  pm: {},
  names: {},
};

interface KvNamespace {
  get(key: string, type: 'json'): Promise<unknown>;
}

function kv(): KvNamespace {
  const { env } = getCloudflareContext();
  const ns = (env as Record<string, unknown>).SNAPSHOT as KvNamespace | undefined;
  if (!ns) throw new Error('Missing SNAPSHOT KV binding (wrangler.jsonc kv_namespaces)');
  return ns;
}

let cache: { at: number; blob: EdgeBlob } | null = null;
const TTL_MS = 60_000;

async function getEdge(): Promise<EdgeBlob> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.blob;
  let blob = EMPTY;
  try {
    const raw = (await kv().get('edge', 'json')) as EdgeBlob | null;
    if (raw) blob = { ...EMPTY, ...raw };
  } catch {
    blob = EMPTY; // key/binding missing → graceful empty
  }
  cache = { at: Date.now(), blob };
  return blob;
}

export async function getEdgeStats(): Promise<EdgeStats> {
  return (await getEdge()).stats;
}

export async function getWallet(): Promise<EdgeWallet | null> {
  return (await getEdge()).wallet;
}

export async function getOpenOpportunities(): Promise<EdgeOpportunity[]> {
  return (await getEdge()).opportunities;
}

export async function getPaperOrders(): Promise<EdgePaperOrder[]> {
  return (await getEdge()).orders;
}

export async function getOddsBoard(): Promise<MatchOddsBoard[]> {
  return (await getEdge()).board;
}

export async function getMatchNames(): Promise<Map<number, { home: string; away: string }>> {
  const e = await getEdge();
  return new Map(Object.entries(e.names).map(([k, v]) => [Number(k), v]));
}

export async function getPmIndex(): Promise<Map<string, PmQuoteInfo>> {
  const e = await getEdge();
  return new Map(Object.entries(e.pm));
}
