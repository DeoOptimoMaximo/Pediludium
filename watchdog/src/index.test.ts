import { beforeEach, describe, expect, it, vi } from 'vitest';
import { check, encodeHeader } from './index.ts';

/**
 * The watchdog's whole value is being trustworthy: it must page when the Mac genuinely dies and
 * stay quiet when the Mac is merely asleep. Getting that balance wrong in either direction makes
 * it useless — a silent watchdog protects nothing, a chatty one gets muted within a week.
 */

const NOW = Date.parse('2026-07-20T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

function fakeEnv(store: Record<string, unknown> = {}) {
  const sent: { title: string; body: string; priority: string }[] = [];
  const env = {
    NTFY_TOPIC: 'test-topic',
    STALE_H: '12',
    SNAPSHOT: {
      get: async (k: string) => store[k] ?? null,
      put: async (k: string, v: string) => { store[k] = JSON.parse(v); },
    },
  } as never;
  vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    sent.push({ title: init.headers.Title, body: init.body, priority: init.headers.Priority });
    return new Response('ok');
  });
  return { env, sent, store };
}

beforeEach(() => vi.unstubAllGlobals());

describe('watchdog', () => {
  it('stays silent through a normal overnight sleep', async () => {
    // The Mac sleeps and launchd does not fire. Nine hours of silence is a laptop, not a corpse.
    const { env, sent } = fakeEnv({ health: { generated_at: hoursAgo(9), level: 'ok', checks: [] } });
    expect(await check(env, NOW)).toBe('ok:9.0h');
    expect(sent).toHaveLength(0);
  });

  it('pages once the silence outlasts any plausible sleep', async () => {
    const { env, sent } = fakeEnv({ health: { generated_at: hoursAgo(20), level: 'ok', checks: [] } });
    expect(await check(env, NOW)).toBe('stale:20.0h');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toContain('launchd');
  });

  it('points at the machine, not the app — the operator must know where to look', async () => {
    const { env, sent } = fakeEnv({ health: { generated_at: hoursAgo(20), level: 'red', checks: [] } });
    await check(env, NOW);
    expect(sent[0]!.body).toContain('RED'); // last known state is the first clue on arrival
    expect(sent[0]!.body).toMatch(/ugašen|uspavan/);
  });

  it('does not repage inside the cooldown', async () => {
    const { env, sent } = fakeEnv({
      health: { generated_at: hoursAgo(20), level: 'ok', checks: [] },
      'watchdog:state': { lastAlertAt: hoursAgo(2) },
    });
    await check(env, NOW);
    expect(sent).toHaveLength(0);
  });

  it('repages once the cooldown has passed — a dead Mac stays dead', async () => {
    const { env, sent } = fakeEnv({
      health: { generated_at: hoursAgo(40), level: 'ok', checks: [] },
      'watchdog:state': { lastAlertAt: hoursAgo(13) },
    });
    await check(env, NOW);
    expect(sent).toHaveLength(1);
  });

  it('announces recovery and clears the cooldown, so the next silence pages immediately', async () => {
    const store: Record<string, unknown> = {
      health: { generated_at: hoursAgo(1), level: 'ok', checks: [] },
      'watchdog:state': { lastAlertAt: hoursAgo(5) },
    };
    const { env, sent } = fakeEnv(store);
    expect(await check(env, NOW)).toBe('ok:1.0h');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.priority).toBe('low');
    expect((store['watchdog:state'] as { lastAlertAt?: string }).lastAlertAt).toBeUndefined();
  });

  it('treats a missing health key as a failure, not as "nothing to report"', async () => {
    const { env, sent } = fakeEnv({});
    expect(await check(env, NOW)).toBe('no-health-key');
    expect(sent).toHaveLength(1);
  });
});

describe('encodeHeader', () => {
  it('round-trips Croatian diacritics and emoji through the ByteString limit', () => {
    const title = 'Pediludium 🔴 kućni pipeline šuti';
    const encoded = encodeHeader(title);
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    const b64 = encoded.slice('=?UTF-8?B?'.length, -'?='.length);
    expect(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).toBe(title);
  });
});
