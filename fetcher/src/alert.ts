import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Out-of-band alerting (docs/21 §2A).
 *
 * Design constraint that drives everything here: **an alert must survive the failure it is
 * reporting**. The incident this exists to prevent was Postgres being unreachable for days, so
 * the alert path may not touch Postgres — not to send, and not to remember what it already sent.
 * Hence ntfy.sh (a plain HTTPS POST, no account, no SDK) plus a JSON state file on local disk.
 *
 * Delivery is best-effort by design: if the network is down too, we log and move on rather than
 * failing the caller. An alerter that can crash the health check is worse than no alerter.
 *
 * Config (fetcher/.env, per the secrets-zero-leakage convention — the topic is a shared secret,
 * anyone who knows it can read and post, so it never lands in git):
 *   HEALTH_NTFY_TOPIC   opaque topic name, e.g. pediludium-ops-7f3a91  (unset = alerting off)
 *   HEALTH_NTFY_SERVER  default https://ntfy.sh
 *   HEALTH_ALERT_COOLDOWN_H  default 6
 */

const STATE_DIR = path.resolve(import.meta.dirname, '..', 'snapshot');
const STATE_FILE = path.join(STATE_DIR, '.alert-state.json');

const TOPIC = process.env.HEALTH_NTFY_TOPIC ?? '';
const SERVER = (process.env.HEALTH_NTFY_SERVER ?? 'https://ntfy.sh').replace(/\/+$/, '');
const COOLDOWN_H = Number(process.env.HEALTH_ALERT_COOLDOWN_H ?? 6);

export type AlertKind =
  | 'db-down'
  | 'stale-refresh'
  | 'stranded-matches'
  | 'stale-publish'
  | 'proxy-down'
  | 'test';

type State = Record<string, { lastSentAt: string }>;

async function readState(): Promise<State> {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8')) as State;
  } catch {
    return {}; // a corrupt state file must not suppress alerts — worst case we re-notify once
  }
}

async function writeState(s: State): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(s, null, 2) + '\n');
}

/**
 * True when `kind` has not been alerted within the cooldown. Pure decision, exported so the
 * cooldown can be unit-tested without a clock or a filesystem.
 */
export function isDue(lastSentAt: string | undefined, now: number, cooldownH: number): boolean {
  if (!lastSentAt) return true;
  const last = Date.parse(lastSentAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= cooldownH * 3600_000;
}

/**
 * HTTP header values are ByteStrings — anything above U+00FF throws before the request is even
 * sent. Our titles are Croatian and carry both diacritics and a status emoji, which killed every
 * alert until the first end-to-end test surfaced it. ntfy decodes RFC 2047 encoded-words, so
 * non-ASCII titles go over the wire base64'd. Exported for testing.
 */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export interface AlertResult {
  sent: boolean;
  reason: 'sent' | 'cooldown' | 'not-configured' | 'failed';
}

/**
 * Send one alert, at most once per `HEALTH_ALERT_COOLDOWN_H` per kind. Recovery notices
 * (`priority: 'low'`) bypass nothing — they use the same cooldown so a flapping service can't
 * spam either direction.
 */
export async function alert(
  kind: AlertKind,
  title: string,
  body: string,
  opts: { priority?: 'low' | 'default' | 'high'; force?: boolean } = {},
): Promise<AlertResult> {
  if (!TOPIC) {
    console.warn(`[alert] ${kind}: HEALTH_NTFY_TOPIC not set — would have sent: ${title}`);
    return { sent: false, reason: 'not-configured' };
  }

  const state = await readState();
  if (!opts.force && !isDue(state[kind]?.lastSentAt, Date.now(), COOLDOWN_H)) {
    console.log(`[alert] ${kind}: within ${COOLDOWN_H}h cooldown — not resending`);
    return { sent: false, reason: 'cooldown' };
  }

  try {
    const res = await fetch(`${SERVER}/${TOPIC}`, {
      method: 'POST',
      headers: {
        Title: encodeHeader(title),
        Priority: opts.priority ?? 'high',
        Tags: opts.priority === 'low' ? 'white_check_mark' : 'rotating_light',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`ntfy ${res.status}`);
  } catch (err) {
    // Deliberately not fatal: the caller is a health check, and a health check that dies when
    // the notifier is unreachable reports nothing at all.
    console.warn(`[alert] ${kind}: delivery failed (${String(err).slice(0, 100)})`);
    return { sent: false, reason: 'failed' };
  }

  state[kind] = { lastSentAt: new Date().toISOString() };
  await writeState(state);
  console.log(`[alert] ${kind}: sent — ${title}`);
  return { sent: true, reason: 'sent' };
}

/** Clear a kind's cooldown so the next occurrence alerts immediately (used on recovery). */
export async function clearAlert(kind: AlertKind): Promise<void> {
  const state = await readState();
  if (state[kind]) {
    delete state[kind];
    await writeState(state);
  }
}

// `npm run alert:test` — verify the notification path end to end before trusting it.
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await alert(
    'test',
    'Pediludium — test alarma',
    'Ako vidiš ovu poruku, put obavijesti radi (docs/21 §2A).',
    { priority: 'default', force: true },
  );
  console.log(`[alert] test → ${r.reason}`);
  process.exitCode = r.sent ? 0 : 1;
}
