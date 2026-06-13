import { describe, expect, it } from 'vitest';
import { CircuitOpenError, PoliteClient, RateLimitedError, jitter, pickUserAgent } from './politeness.ts';

const fastOpts = {
  delayMinMs: 1,
  delayMaxMs: 2,
  maxRetries: 2,
  backoffMinMs: 1,
  backoffMaxMs: 2,
  circuitThreshold: 3,
  circuitCooldownMs: 10_000,
};

describe('jitter', () => {
  it('stays within [min, max)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = jitter(100, 200);
      expect(v).toBeGreaterThanOrEqual(100);
      expect(v).toBeLessThan(200);
    }
  });
});

describe('pickUserAgent', () => {
  it('returns a non-empty browser-ish UA', () => {
    expect(pickUserAgent()).toMatch(/Mozilla\/5\.0/);
  });
});

describe('PoliteClient', () => {
  it('runs tasks serially in order', async () => {
    const client = new PoliteClient(fastOpts);
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => client.run(async () => order.push(n))));
    expect(order).toEqual([1, 2, 3]);
  });

  it('retries on RateLimitedError then succeeds', async () => {
    const client = new PoliteClient(fastOpts);
    let calls = 0;
    const result = await client.run(async () => {
      calls += 1;
      if (calls < 2) throw new RateLimitedError(429);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('floors the backoff when the server sends Retry-After: 0 (no instant hammer)', async () => {
    // A challenge 403 often carries Retry-After: 0; the client must still wait its jittered
    // backoff, not retry instantly (which used to trip the breaker in milliseconds).
    const client = new PoliteClient({
      ...fastOpts,
      delayMinMs: 1,
      delayMaxMs: 2,
      backoffMinMs: 40,
      backoffMaxMs: 50,
      maxRetries: 2,
      circuitThreshold: 5,
    });
    let calls = 0;
    const start = Date.now();
    const result = await client.run(async () => {
      calls += 1;
      if (calls < 2) throw new RateLimitedError(429, 0); // server hint: 0ms
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
    expect(Date.now() - start).toBeGreaterThanOrEqual(35); // floored to ~backoffMin, not 0
  });

  it('trips the circuit breaker after threshold consecutive blocks', async () => {
    const client = new PoliteClient({ ...fastOpts, maxRetries: 10 });
    await expect(
      client.run(async () => {
        throw new RateLimitedError(403);
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
  });
});
