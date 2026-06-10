import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Snapshot publisher — pushes the export-snapshot.ts artifacts to Cloudflare:
 *   1. KV (namespace SNAPSHOT): differential upload — only keys whose value changed since
 *      the last successful publish (KV writes cost $5/M; a full 100+-key upload every hour
 *      would be waste when only `core` changes between runs)
 *   2. R2 (pediludium-snapshots): the full snapshot.json archived under its generated_at
 *      timestamp — the immutable prediction history for later calibration (Brier/log-loss)
 *
 * Cron chain: `npm run snapshot` = export + publish. Requires wrangler OAuth login
 * (same machine as the fetcher; see web/wrangler.jsonc for the serving side).
 */

const ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? '7dc7167b7e2e00923bfa7cd697df14e4'; // D.O.M.
const KV_NAMESPACE_ID = process.env.CF_KV_NAMESPACE_ID ?? '7b0c159c53f14f868fd6504dae5d94ba'; // SNAPSHOT
const R2_BUCKET = process.env.CF_R2_BUCKET ?? 'pediludium-snapshots';

const FETCHER_DIR = path.resolve(import.meta.dirname, '..');
const SNAP_DIR = path.join(FETCHER_DIR, 'snapshot');
const STATE_FILE = path.join(SNAP_DIR, '.published-kv.json'); // KV state as of last publish

function wrangler(args: string[]): void {
  const res = spawnSync('npx', ['wrangler', ...args], {
    cwd: FETCHER_DIR,
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
  });
  if (res.status !== 0) throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed (exit ${res.status})`);
}

interface KvEntry {
  key: string;
  value: string;
}

async function main(): Promise<void> {
  const desired: KvEntry[] = JSON.parse(await readFile(path.join(SNAP_DIR, 'kv-bulk.json'), 'utf8'));
  const previous: KvEntry[] = existsSync(STATE_FILE)
    ? JSON.parse(await readFile(STATE_FILE, 'utf8'))
    : [];
  const prevByKey = new Map(previous.map((e) => [e.key, e.value]));
  const desiredKeys = new Set(desired.map((e) => e.key));

  const delta = desired.filter((e) => prevByKey.get(e.key) !== e.value);
  const removed = previous.map((e) => e.key).filter((k) => !desiredKeys.has(k));

  if (delta.length > 0) {
    const deltaFile = path.join(SNAP_DIR, 'kv-delta.json');
    await writeFile(deltaFile, JSON.stringify(delta));
    wrangler(['kv', 'bulk', 'put', deltaFile, `--namespace-id=${KV_NAMESPACE_ID}`, '--remote']);
  }
  if (removed.length > 0) {
    const deleteFile = path.join(SNAP_DIR, 'kv-deleted.json');
    await writeFile(deleteFile, JSON.stringify(removed));
    wrangler(['kv', 'bulk', 'delete', deleteFile, `--namespace-id=${KV_NAMESPACE_ID}`, '--remote', '--force']);
  }
  await writeFile(STATE_FILE, JSON.stringify(desired));
  console.log(`[publish] KV: ${delta.length} put, ${removed.length} deleted (of ${desired.length} keys)`);

  // R2 archive (best-effort — the live site only needs KV)
  try {
    const snapshotFile = path.join(SNAP_DIR, 'snapshot.json');
    const snap = JSON.parse(await readFile(snapshotFile, 'utf8'));
    const ts = String(snap.core.generated_at).replace(/:/g, '-');
    wrangler(['r2', 'object', 'put', `${R2_BUCKET}/snapshots/${ts}.json`, `--file=${snapshotFile}`, '--remote']);
    console.log(`[publish] R2: archived snapshots/${ts}.json`);
  } catch (err) {
    console.warn(`[publish] R2 archive failed (non-fatal): ${String(err).slice(0, 120)}`);
  }
}

main().catch((err) => {
  console.error('[publish] fatal:', err);
  process.exitCode = 1;
});
