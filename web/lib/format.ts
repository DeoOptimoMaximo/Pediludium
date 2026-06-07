const TZ = 'Europe/Zagreb';

/** alpha2 → flag emoji; returns '' for non-ISO codes (e.g. EN, SX) so UI can fall back. */
export function flag(alpha2: string | null | undefined): string {
  if (!alpha2 || alpha2.length !== 2 || !/^[A-Za-z]{2}$/.test(alpha2)) return '';
  const cc = alpha2.toUpperCase();
  // a few SofaScore codes are not ISO regions and won't render a flag — skip them
  if (['EN', 'SX', 'XK'].includes(cc)) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(A + (cc.charCodeAt(0) - 65), A + (cc.charCodeAt(1) - 65));
}

export function fmtDay(iso: string | null): string {
  if (!iso) return 'TBD';
  return new Intl.DateTimeFormat('en-GB', {
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

export function teamLogo(teamId: number | null | undefined): string {
  return teamId ? `https://api.sofascore.com/api/v1/team/${teamId}/image` : '';
}

export function isLive(statusType: string | null): boolean {
  return statusType === 'inprogress';
}
