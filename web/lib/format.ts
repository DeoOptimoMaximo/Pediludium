import type { Lang } from './i18n';

const TZ = 'Europe/Zagreb';
const LOCALE: Record<Lang, string> = { hr: 'hr-HR', en: 'en-GB' };

/**
 * alpha2 → flag emoji. England/Scotland/Wales are not ISO regions — they render via
 * Unicode subdivision tag sequences (🏴 + gb{eng,sct,wls} tags) instead of the
 * regional-indicator pair.
 */
const SUBDIVISION_FLAGS: Record<string, string> = {
  EN: subdivisionFlag('gbeng'), // England
  SX: subdivisionFlag('gbsct'), // Scotland (source uses SX)
  WA: subdivisionFlag('gbwls'), // Wales
};

function subdivisionFlag(code: string): string {
  const TAG_BASE = 0xe0000;
  const CANCEL = String.fromCodePoint(0xe007f);
  return (
    '\u{1F3F4}' +
    [...code].map((ch) => String.fromCodePoint(TAG_BASE + ch.charCodeAt(0))).join('') +
    CANCEL
  );
}

export function flag(alpha2: string | null | undefined): string {
  if (!alpha2 || alpha2.length !== 2 || !/^[A-Za-z]{2}$/.test(alpha2)) return '';
  const cc = alpha2.toUpperCase();
  if (SUBDIVISION_FLAGS[cc]) return SUBDIVISION_FLAGS[cc];
  if (cc === 'XK') return ''; // Kosovo has no emoji flag yet
  const A = 0x1f1e6;
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65));
}

export function fmtDay(iso: string | null, lang: Lang = 'en'): string {
  if (!iso) return 'TBD';
  return new Intl.DateTimeFormat(LOCALE[lang], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: TZ,
  }).format(new Date(iso));
}

export function fmtTime(iso: string | null): string {
  if (!iso) return '--:--';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso));
}

export function dayKey(iso: string | null): string {
  if (!iso) return 'TBD';
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: TZ,
  }).format(new Date(iso));
}

export function pct(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 100);
}

export function isLive(statusType: string | null): boolean {
  return statusType === 'inprogress';
}
