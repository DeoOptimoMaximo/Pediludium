import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import pg from 'pg';
import { alert, clearAlert } from './alert.ts';
import { config, WORLD_CUP } from './config.ts';

/**
 * Health check (docs/21 §2A) — launchd: com.pediludium.health, every 30 min.
 *
 * Why this exists: forensics on ~/Library/Logs/pediludium/matchsync.log found EIGHTEEN separate
 * Postgres outages between 2026-06-18 and 2026-07-18 (the longest ~6 days) in which every single
 * launchd tick still exited 0. The gates fail safe — an unreachable DB is treated as "nothing to
 * do" so a dead database can't burn Firecrawl credits — which is right, but it meant the system
 * had no way at all to say it was sick. This job is the one thing whose entire purpose is to say
 * so, out of band.
 *
 * Deliberately does NOT import db.ts: that module opens a shared pool at import time, and the
 * failure this check most needs to report is precisely "Postgres is unreachable". It uses its own
 * client with a hard connect timeout so a hung DB degrades into a red check rather than a hang.
 *
 *   npm run health          check, alert on red, write the `health` KV key
 *   npm run health -- --dry check and print, no alerts, no KV write
 */

const SNAP_DIR = path.resolve(import.meta.dirname, '..', 'snapshot');
const DIGEST_FILE = path.join(SNAP_DIR, '.last-publish-digest');
const HEALTH_FILE = path.join(SNAP_DIR, 'health.json');
const KV_STATE_FILE = path.join(SNAP_DIR, '.published-health.json');

const DRY = process.argv.includes('--dry');
/**
 * Suppress the db-down page on this run and exit 2 instead, so the caller can attempt repair and
 * re-check. Passed by health-check.sh on its first pass only: a transient dark-wake stall that
 * the guard fixes in thirty seconds must not page anyone, but a manual `npm run health` still
 * alerts immediately, and the second pass (without this flag) pages if the repair failed.
 */
const DEFER_DB_ALERT = process.argv.includes('--defer-db-alert');
const EXIT_DB_DOWN = 2;
const CONNECT_TIMEOUT_MS = 8_000;
/** A refresh older than this means the ingest path has stopped working. */
const STALE_REFRESH_H = Number(process.env.HEALTH_STALE_REFRESH_H ?? 6);
/** A publish older than this, *while work is pending*, means the site is going stale. */
const STALE_PUBLISH_H = Number(process.env.HEALTH_STALE_PUBLISH_H ?? 6);

export type Level = 'ok' | 'warn' | 'red';

export interface Check {
  id: string;
  level: Level;
  message: string;
  detail?: Record<string, unknown>;
}

/* ── individual checks ──────────────────────────────────────────────────── */

async function checkDb(): Promise<{ check: Check; client: pg.Client | null }> {
  const client = new pg.Client({
    connectionString: config.dbUrl,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query('select 1');
    return { check: { id: 'db', level: 'ok', message: 'Postgres dostupan' }, client };
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    await client.end().catch(() => {});
    const refused = msg.includes('ECONNREFUSED');
    return {
      check: {
        id: 'db',
        level: 'red',
        // The single most valuable line in the whole alert: during the incident the operator's
        // question was always "what do I actually type to fix this?".
        message: refused
          ? `Supabase/Postgres nedostupan na ${config.dbUrl.replace(/\/\/[^@]*@/, '//***@')} — ` +
            'pokreni: open -a Docker && cd Pediludium && supabase start'
          : `Postgres greška: ${msg.slice(0, 160)}`,
        detail: { error: msg.slice(0, 300) },
      },
      client: null,
    };
  }
}

/**
 * Age of the newest successful ingest-path heartbeat.
 *
 * `sync-gate` counts, not just `refresh:fc`: the gate beats every 15 minutes whether or not there
 * is anything to fetch, so an idle-but-healthy system (an archived season with no fixtures left)
 * stays green, while a broken one goes red. Keying liveness off actual fetches would make "the
 * tournament is over" indistinguishable from "ingest is dead" and leave the check permanently red.
 */
async function checkIngestAge(client: pg.Client): Promise<Check> {
  const { rows } = await client.query<{ key: string; age_h: string }>(
    `select key, extract(epoch from (now() - at)) / 3600 as age_h
       from public.ops_heartbeat where key in ('refresh:fc', 'refresh', 'sync-gate') and ok`,
  );
  if (rows.length === 0) {
    return { id: 'ingest', level: 'warn', message: 'nema zabilježenog uspješnog ticka (heartbeat prazan)' };
  }
  const youngest = Math.min(...rows.map((r) => Number(r.age_h)));
  if (youngest > STALE_REFRESH_H) {
    return {
      id: 'ingest',
      level: 'red',
      message: `zadnji uspješan ingest tick prije ${youngest.toFixed(1)} h (prag ${STALE_REFRESH_H} h) — ` +
        'launchd job ne radi ili ne može do baze',
      detail: { age_h: Number(youngest.toFixed(2)) },
    };
  }
  return {
    id: 'ingest',
    level: 'ok',
    message: `ingest tick svjež (${youngest.toFixed(1)} h)`,
    detail: { age_h: Number(youngest.toFixed(2)) },
  };
}

async function checkStranded(client: pg.Client): Promise<Check> {
  const { rows } = await client.query<{
    ss_id: string; home: string | null; away: string | null; hours_late: string;
  }>(
    `select m.ss_id,
            coalesce(th.name, m.raw->'homeTeam'->>'name') as home,
            coalesce(ta.name, m.raw->'awayTeam'->>'name') as away,
            extract(epoch from (now() - m.start_ts)) / 3600 as hours_late
       from public.match m
       left join public.team th on th.ss_id = m.home_team_id
       left join public.team ta on ta.ss_id = m.away_team_id
      where m.season_id = $1
        and m.status_type is distinct from 'finished'
        and m.start_ts < now() - interval '3 hours'
      order by m.start_ts`,
    [WORLD_CUP.seasonId2026],
  );
  if (rows.length === 0) return { id: 'stranded', level: 'ok', message: 'nema zaglavljenih utakmica' };
  const names = rows.slice(0, 5).map((r) => `${r.home ?? '?'} v ${r.away ?? '?'}`).join(', ');
  return {
    id: 'stranded',
    level: 'red',
    message: `${rows.length} utakmica odigrana a bez rezultata: ${names}`,
    detail: { count: rows.length, ids: rows.map((r) => Number(r.ss_id)) },
  };
}

/** Best-effort TCP reachability of the iPhone mobile proxy — informational, never red. */
async function checkProxy(): Promise<Check> {
  const target = config.proxyServer ?? process.env.SOFA_PROXY_SERVER ?? '';
  if (!target) return { id: 'proxy', level: 'ok', message: 'mobilni proxy nije konfiguriran (preskočeno)' };
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return { id: 'proxy', level: 'warn', message: `neispravan SOFA_PROXY_SERVER: ${target}` };
  }
  const reachable = await new Promise<boolean>((resolve) => {
    const sock = net.connect({ host: url.hostname, port: Number(url.port || 8888) });
    const done = (v: boolean) => { sock.destroy(); resolve(v); };
    sock.setTimeout(4_000);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
  // Warn, never red: the Firecrawl path is the supported transport for results and the phone
  // proxy has been down for weeks by design (docs/21 §0). Alerting red on it would train the
  // operator to ignore the alert channel — the one failure mode a pager must never have.
  return reachable
    ? { id: 'proxy', level: 'ok', message: 'mobilni proxy dostupan' }
    : { id: 'proxy', level: 'warn', message: `mobilni proxy nedostupan (${url.host}) — Firecrawl put je aktivan` };
}

/**
 * Age of the last KV publish. Only red when there is actually work pending: once a season is
 * finished and archived the snapshot is *supposed* to sit unchanged forever, and a check that
 * screams about that would be permanently red (and therefore permanently ignored).
 */
async function checkPublishAge(pendingWork: boolean): Promise<Check> {
  if (!existsSync(DIGEST_FILE)) {
    return { id: 'publish', level: 'warn', message: 'nema zapisa o objavljenom snapshotu' };
  }
  const age_h = (Date.now() - (await stat(DIGEST_FILE)).mtimeMs) / 3600_000;
  if (pendingWork && age_h > STALE_PUBLISH_H) {
    return {
      id: 'publish',
      level: 'red',
      message: `snapshot nije objavljen ${age_h.toFixed(1)} h, a ima neobrađenih utakmica`,
      detail: { age_h: Number(age_h.toFixed(2)) },
    };
  }
  return {
    id: 'publish',
    level: 'ok',
    message: `zadnji publish prije ${age_h.toFixed(1)} h${pendingWork ? '' : ' (sezona mirna)'}`,
    detail: { age_h: Number(age_h.toFixed(2)) },
  };
}

/* ── KV publish of the health blob ──────────────────────────────────────── */

/**
 * Push `health` to KV, but only when the *status* changed — not on every tick. The blob carries a
 * timestamp, so writing it blindly would be 48 KV writes a day against a 1000/day free tier, for
 * no information (the same lesson as should-publish.ts). The digest deliberately excludes the
 * timestamp and rounds ages into hour buckets.
 */
async function publishHealth(payload: Record<string, unknown>, checks: Check[]): Promise<void> {
  const digest = checks.map((c) => `${c.id}:${c.level}`).join('|');
  const prev = existsSync(KV_STATE_FILE)
    ? JSON.parse(await readFile(KV_STATE_FILE, 'utf8')).digest
    : null;
  if (prev === digest) {
    console.log('[health] KV: status nepromijenjen — bez upisa');
    return;
  }
  const { spawnSync } = await import('node:child_process');
  const file = path.join(SNAP_DIR, 'kv-health.json');
  await writeFile(file, JSON.stringify([{ key: 'health', value: JSON.stringify(payload) }]));
  const res = spawnSync(
    'npx',
    ['wrangler', 'kv', 'bulk', 'put', file,
     `--namespace-id=${process.env.CF_KV_NAMESPACE_ID ?? '7b0c159c53f14f868fd6504dae5d94ba'}`, '--remote'],
    {
      cwd: path.resolve(import.meta.dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: process.env.CF_ACCOUNT_ID ?? '7dc7167b7e2e00923bfa7cd697df14e4' },
    },
  );
  if (res.status !== 0) {
    console.warn('[health] KV upis nije uspio (nefatalno)');
    return;
  }
  await writeFile(KV_STATE_FILE, JSON.stringify({ digest }));
  console.log(`[health] KV: objavljen status ${digest}`);
}

/* ── main ───────────────────────────────────────────────────────────────── */

export function worstLevel(checks: Check[]): Level {
  if (checks.some((c) => c.level === 'red')) return 'red';
  if (checks.some((c) => c.level === 'warn')) return 'warn';
  return 'ok';
}

async function main(): Promise<void> {
  const checks: Check[] = [];
  const { check: dbCheck, client } = await checkDb();
  checks.push(dbCheck);

  let pendingWork = false;
  if (client) {
    const stranded = await checkStranded(client);
    pendingWork = stranded.level !== 'ok';
    checks.push(await checkIngestAge(client), stranded);
    await client
      .query(
        `insert into public.ops_heartbeat (key, at, ok, detail) values ('health', now(), true, null)
         on conflict (key) do update set at = now(), ok = true`,
      )
      .catch(() => {});
    await client.end().catch(() => {});
  }
  checks.push(await checkProxy(), await checkPublishAge(pendingWork));

  const level = worstLevel(checks);
  const payload = {
    generated_at: new Date().toISOString(),
    level,
    checks: checks.map((c) => ({ id: c.id, level: c.level, message: c.message, ...(c.detail ? { detail: c.detail } : {}) })),
  };

  const icon = { ok: '✅', warn: '⚠️', red: '🔴' } as const;
  console.log(`[health] ${icon[level]} ${level.toUpperCase()}`);
  for (const c of checks) console.log(`  ${icon[c.level]} ${c.id}: ${c.message}`);

  await writeFile(HEALTH_FILE, JSON.stringify(payload, null, 2) + '\n').catch(() => {});
  if (DRY) {
    console.log('[health] --dry: bez alarma i bez KV upisa');
    return;
  }
  if (DEFER_DB_ALERT && dbCheck.level === 'red') {
    console.log('[health] baza je crvena — prepuštam oporavak guardu, alarm slijedi tek ako ne uspije');
    process.exitCode = EXIT_DB_DOWN;
    return;
  }

  // One alert per failing subsystem, each on its own cooldown, so a DB outage doesn't drown out
  // an unrelated stranded match — and so recovery of one doesn't silence the other.
  const reds = checks.filter((c) => c.level === 'red');
  for (const c of reds) {
    const kind = c.id === 'db' ? 'db-down' : c.id === 'ingest' ? 'stale-refresh'
      : c.id === 'stranded' ? 'stranded-matches' : 'stale-publish';
    await alert(kind, `Pediludium 🔴 ${c.id}`, c.message);
  }
  for (const c of checks.filter((c) => c.level === 'ok')) {
    const kind = c.id === 'db' ? 'db-down' : c.id === 'ingest' ? 'stale-refresh'
      : c.id === 'stranded' ? 'stranded-matches' : c.id === 'publish' ? 'stale-publish' : null;
    if (kind) await clearAlert(kind);
  }

  await publishHealth(payload, checks).catch((err) =>
    console.warn(`[health] KV objava preskočena: ${String(err).slice(0, 120)}`),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[health] fatal:', err);
    process.exitCode = 1;
  });
}
