/**
 * Dead-man's switch for the home pipeline (docs/21 §2E).
 *
 * The health check added in §2 closed the "something is broken" hole, but not the one behind it:
 * it runs ON the Mac. If the Mac is off, asleep for good, or launchd itself is wedged, nothing
 * runs, nothing is sent, and silence is indistinguishable from health — the exact shape of the
 * failure that hid eighteen outages. A watchdog cannot live in the system it watches.
 *
 * So this runs on Cloudflare, on a cron, and watches the one artifact the Mac produces that
 * Cloudflare can see: the `health` KV key. If it stops being refreshed, the Mac has gone quiet
 * and we say so. It shares no failure domain with the thing it monitors — different machine,
 * different network, different power.
 *
 * Deliberately tiny and dependency-free. A watchdog with its own failure modes is a liability;
 * this one reads a key, compares a timestamp, and posts to ntfy.
 */

interface Env {
  SNAPSHOT: KVNamespace;
  NTFY_TOPIC: string; // secret — `npx wrangler secret put NTFY_TOPIC`
  NTFY_SERVER?: string;
  /** Hours of silence tolerated before we call it. */
  STALE_H?: string;
}

interface HealthBlob {
  generated_at: string;
  level: 'ok' | 'warn' | 'red';
  checks: { id: string; level: string; message: string }[];
}

const STATE_KEY = 'watchdog:state';
const COOLDOWN_H = 12;

interface State {
  lastAlertAt?: string;
  lastSeenAt?: string;
}

async function notify(env: Env, title: string, body: string, priority = 'high'): Promise<void> {
  const server = (env.NTFY_SERVER ?? 'https://ntfy.sh').replace(/\/+$/, '');
  await fetch(`${server}/${env.NTFY_TOPIC}`, {
    method: 'POST',
    headers: {
      // Header values are ByteStrings; Croatian titles carry diacritics and an emoji, so the
      // same RFC 2047 encoding the fetcher's alert.ts learned to use applies here too.
      Title: encodeHeader(title),
      Priority: priority,
      Tags: priority === 'low' ? 'white_check_mark' : 'rotating_light',
    },
    body,
  });
}

export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;
}

export async function check(env: Env, now: number): Promise<string> {
  /**
   * Twelve hours by default, not one. The Mac legitimately sleeps overnight, and launchd simply
   * does not fire while it does — a tight threshold would page every single morning, and an
   * alarm that cries wolf daily is worse than no alarm at all (the whole reason the proxy check
   * in health.ts is a warn and never a red). Twelve hours still catches "the machine never came
   * back" within one working day, which is the failure this exists for.
   */
  const staleH = Number(env.STALE_H ?? 12);
  const state = ((await env.SNAPSHOT.get(STATE_KEY, 'json')) as State | null) ?? {};
  const health = (await env.SNAPSHOT.get('health', 'json')) as HealthBlob | null;

  const cooling =
    state.lastAlertAt && now - Date.parse(state.lastAlertAt) < COOLDOWN_H * 3600_000;

  if (!health) {
    if (!cooling) {
      await notify(env, 'Pediludium 🔴 watchdog', 'KV ključ `health` ne postoji — kućni pipeline se nikad nije javio.');
      await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ ...state, lastAlertAt: new Date(now).toISOString() }));
    }
    return 'no-health-key';
  }

  const ageH = (now - Date.parse(health.generated_at)) / 3600_000;

  if (ageH > staleH) {
    if (!cooling) {
      await notify(
        env,
        'Pediludium 🔴 kućni pipeline šuti',
        `Zadnji health izvještaj prije ${ageH.toFixed(1)} h (prag ${staleH} h).\n` +
          `Zadnje poznato stanje: ${health.level.toUpperCase()}.\n` +
          'Mac je vjerojatno ugašen, uspavan ili je launchd stao — provjeri stroj, ne aplikaciju.',
      );
      await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ ...state, lastAlertAt: new Date(now).toISOString() }));
    }
    return `stale:${ageH.toFixed(1)}h`;
  }

  // Recovered: clear the cooldown so the next silence pages immediately rather than being
  // swallowed by a stale timer, and tell the operator the machine is talking again.
  if (state.lastAlertAt) {
    await notify(env, 'Pediludium ✅ pipeline se opet javlja', `Health izvještaj star ${ageH.toFixed(1)} h.`, 'low');
    await env.SNAPSHOT.put(STATE_KEY, JSON.stringify({ lastSeenAt: new Date(now).toISOString() }));
  }
  return `ok:${ageH.toFixed(1)}h`;
}

export default {
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    console.log(`[watchdog] ${await check(env, Date.now())}`);
  },
  // Manual probe: `curl https://<worker>/` — same logic, visible result. No secrets exposed.
  async fetch(_req: Request, env: Env): Promise<Response> {
    return new Response(`${await check(env, Date.now())}\n`);
  },
};
