/**
 * Politeness layer — the heart of the fetcher (docs/03).
 * Random delay + jitter, realistic UA rotation, serial (concurrency 1),
 * retry with exponential backoff, honor 429/Retry-After, circuit breaker.
 *
 * No deps: just timers + native fetch (caller passes the fetch thunk).
 */

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Uniform random in [min, max). */
export const jitter = (min: number, max: number): number =>
  min + Math.random() * (max - min);

/** A small pool of real, current browser UA strings. Rotated per request. */
const USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

export const pickUserAgent = (): string =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;

export interface PolitenessOptions {
  delayMinMs: number;
  delayMaxMs: number;
  maxRetries: number;
  backoffMinMs: number;
  backoffMaxMs: number;
  circuitThreshold: number;
  circuitCooldownMs: number;
}

/** Thrown when the circuit breaker is open (too many consecutive blocks). */
export class CircuitOpenError extends Error {
  readonly reopenAt: number;
  constructor(reopenAt: number) {
    super(`Circuit breaker open until ${new Date(reopenAt).toISOString()}`);
    this.name = 'CircuitOpenError';
    this.reopenAt = reopenAt;
  }
}

/** Caller throws this from the thunk to signal a rate-limit/block we should back off on. */
export class RateLimitedError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(status: number, retryAfterMs?: number) {
    super(`Blocked with status ${status}`);
    this.name = 'RateLimitedError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * PoliteClient enforces a single global serial queue + circuit breaker across all calls.
 * One instance per process = concurrency 1, shared breaker state.
 */
export class PoliteClient {
  private chain: Promise<unknown> = Promise.resolve();
  private consecutiveBlocks = 0;
  private circuitReopenAt = 0;
  private readonly opts: PolitenessOptions;

  constructor(opts: PolitenessOptions) {
    this.opts = opts;
  }

  /** Run `fn` through the polite queue: serialized, delayed, retried, breaker-guarded. */
  run<T>(fn: () => Promise<T>, label = 'request'): Promise<T> {
    const task = this.chain.then(() => this.execute(fn, label));
    // keep the chain alive even if this task rejects, so the queue never wedges
    this.chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async execute<T>(fn: () => Promise<T>, label: string, attempt = 0): Promise<T> {
    if (Date.now() < this.circuitReopenAt) {
      throw new CircuitOpenError(this.circuitReopenAt);
    }

    await sleep(jitter(this.opts.delayMinMs, this.opts.delayMaxMs));

    try {
      const result = await fn();
      this.consecutiveBlocks = 0; // success resets the breaker
      return result;
    } catch (err) {
      if (err instanceof RateLimitedError) {
        this.consecutiveBlocks += 1;
        if (this.consecutiveBlocks >= this.opts.circuitThreshold) {
          this.circuitReopenAt = Date.now() + this.opts.circuitCooldownMs;
          console.warn(
            `[politeness] circuit OPEN after ${this.consecutiveBlocks} blocks; cooling down ${Math.round(
              this.opts.circuitCooldownMs / 1000,
            )}s`,
          );
          throw new CircuitOpenError(this.circuitReopenAt);
        }
        if (attempt < this.opts.maxRetries) {
          // Floor the wait at our jittered exponential backoff: a challenge 403 often carries
          // `Retry-After: 0`, and `0 ?? fallback` is 0 (0 isn't nullish) — which would retry
          // instantly and trip the breaker in milliseconds. Honor a *longer* server hint, never
          // a shorter one.
          const jittered = jitter(this.opts.backoffMinMs, this.opts.backoffMaxMs) * 2 ** attempt;
          const backoff = Math.max(err.retryAfterMs ?? 0, jittered);
          console.warn(
            `[politeness] ${label} got ${err.status}; backoff ${Math.round(backoff)}ms (attempt ${attempt + 1}/${this.opts.maxRetries})`,
          );
          await sleep(backoff);
          return this.execute(fn, label, attempt + 1);
        }
      }
      throw err;
    }
  }
}
