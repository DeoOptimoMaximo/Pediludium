import { describe, expect, it } from 'vitest';
import { encodeHeader, isDue } from './alert.ts';
import { backoffMinutes, isSeasonComplete } from './ops.ts';

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

describe('encodeHeader — RFC 2047 for non-ASCII alert titles', () => {
  // Regression: every alert failed with "Cannot convert argument to a ByteString" because the
  // titles are Croatian and carry a status emoji. Header values are latin1; fetch throws before
  // the request leaves. Caught only by an actual end-to-end send, so it is pinned here.
  it('leaves pure ASCII untouched', () => {
    expect(encodeHeader('Pediludium db-down')).toBe('Pediludium db-down');
  });

  it('encodes diacritics and emoji so fetch can send them', () => {
    for (const title of ['Pediludium 🔴 db', 'ne može do baze', 'Španjolska']) {
      const encoded = encodeHeader(title);
      expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\xFF]*$/.test(encoded)).toBe(true); // now a valid ByteString
      const b64 = encoded.slice('=?UTF-8?B?'.length, -'?='.length);
      expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(title); // round-trips
    }
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

describe('isSeasonComplete — the freeze condition (docs/21 §3B)', () => {
  it('freezes a season whose every fixture has been played', () => {
    expect(isSeasonComplete(104, 104)).toBe(true);
  });

  it('does NOT freeze an empty season — the trap that would brick a new competition', () => {
    // 0 === 0 satisfies a naive played === total. A competition onboarded but not yet
    // ingested would declare itself an archive and freeze the jobs meant to fill it,
    // leaving a season that can never start. This is the single most important case here.
    expect(isSeasonComplete(0, 0)).toBe(false);
  });

  it('keeps a season live while a single fixture is outstanding', () => {
    expect(isSeasonComplete(103, 104)).toBe(false);
    expect(isSeasonComplete(0, 104)).toBe(false);
  });

  it('stays frozen if more finished rows are seen than fixtures counted', () => {
    // Defensive: a counting skew must not un-freeze and restart hourly fetching forever.
    expect(isSeasonComplete(105, 104)).toBe(true);
  });

  it('is independent of tournament size — no 104-shaped constant survives into §4', () => {
    expect(isSeasonComplete(380, 380)).toBe(true); // a 20-team double round-robin league
    expect(isSeasonComplete(379, 380)).toBe(false);
  });
});
