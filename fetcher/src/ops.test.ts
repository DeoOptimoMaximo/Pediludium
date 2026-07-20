import { describe, expect, it } from 'vitest';
import { isDue } from './alert.ts';
import { backoffMinutes } from './ops.ts';

/**
 * Guards on the two pure decisions behind the resilience work (docs/21 §2). Both encode a
 * cost/benefit that is easy to break by "tidying" a magic number, so the reasoning is asserted
 * here rather than left in a comment.
 */

describe('backoffMinutes — escalating per-match check cadence', () => {
  it('stays on the fast cadence for as long as a match could plausibly still be running', () => {
    // 16 ticks × 15 min = 4h: 90' + halftime + stoppage + extra time + penalties + feed lag.
    // Anything inside that must NOT be slowed down, or a live match goes stale on the site.
    for (const attempts of [0, 1, 5, 15]) {
      expect(backoffMinutes(attempts)).toBe(15);
    }
  });

  it('escalates once "unresolved" stops meaning "in play"', () => {
    expect(backoffMinutes(16)).toBe(60);
    expect(backoffMinutes(31)).toBe(60);
    expect(backoffMinutes(32)).toBe(360);
    expect(backoffMinutes(55)).toBe(360);
    expect(backoffMinutes(56)).toBe(1440);
    expect(backoffMinutes(500)).toBe(1440);
  });

  it('is monotonic — a further failed check may never speed the cadence back up', () => {
    let prev = 0;
    for (let a = 0; a <= 120; a++) {
      const m = backoffMinutes(a);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it('bounds the daily Firecrawl cost of a permanently stranded match', () => {
    // The failure mode this replaces: a bracket slot that can never resolve was checked every
    // 15 min indefinitely (~96 credits/day). Past the ladder it must cost at most a handful.
    const perDay = (24 * 60) / backoffMinutes(100);
    expect(perDay).toBeLessThanOrEqual(2);
  });
});

describe('isDue — alert cooldown', () => {
  const now = Date.parse('2026-07-20T12:00:00Z');

  it('alerts when nothing was ever sent', () => {
    expect(isDue(undefined, now, 6)).toBe(true);
  });

  it('suppresses a repeat inside the cooldown', () => {
    expect(isDue('2026-07-20T09:00:00Z', now, 6)).toBe(false);
  });

  it('alerts again once the cooldown has elapsed', () => {
    expect(isDue('2026-07-20T06:00:00Z', now, 6)).toBe(true);
    expect(isDue('2026-07-20T05:59:00Z', now, 6)).toBe(true);
  });

  it('fails open on an unparseable timestamp — a corrupt state file must not mute the pager', () => {
    expect(isDue('not-a-date', now, 6)).toBe(true);
  });
});
