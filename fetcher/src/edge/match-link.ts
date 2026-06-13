import { dbQuery } from '../db.ts';
import { WORLD_CUP } from '../config.ts';

/**
 * Map an external venue's event (named by team strings) to one of our WC2026 fixtures
 * (match.ss_id). Venues name countries differently ("USA" vs "United States", "Korea
 * Republic" vs "South Korea"), so we normalize aggressively and keep a small alias map,
 * then require BOTH teams to resolve to the same fixture. Optional kickoff time breaks
 * ties when the same pairing recurs (it won't within a single WC, but keep it safe).
 */

/** Common country aliases → a canonical token, applied after diacritic/punctuation strip. */
const ALIASES: Record<string, string> = {
  usa: 'unitedstates',
  us: 'unitedstates',
  unitedstatesofamerica: 'unitedstates',
  southkorea: 'korearepublic',
  korea: 'korearepublic',
  northkorea: 'koreadpr',
  ivorycoast: 'cotedivoire',
  czechia: 'czechrepublic',
  bosnia: 'bosniaherzegovina',
  bosniaandherzegovina: 'bosniaherzegovina',
  capeverde: 'caboverde',
  uae: 'unitedarabemirates',
  drcongo: 'congodr',
  republicofireland: 'ireland',
  turkiye: 'turkey',
  iranislamicrepublic: 'iran',
  iririran: 'iran',
  // Croatian country names (HR sportsbooks: SuperSport/PSK/… name teams in Croatian).
  // Each maps to the SAME canonical token an English WC fixture name resolves to.
  alzir: 'algeria',
  australija: 'australia',
  austrija: 'austria',
  belgija: 'belgium',
  bih: 'bosniaherzegovina',
  zelenortskiotoci: 'caboverde',
  kanada: 'canada',
  kolumbija: 'colombia',
  obalabjelokosti: 'cotedivoire',
  hrvatska: 'croatia',
  ceska: 'czechrepublic',
  kongodr: 'congodr',
  drkongo: 'congodr',
  ekvador: 'ecuador',
  egipat: 'egypt',
  engleska: 'england',
  francuska: 'france',
  njemacka: 'germany',
  gana: 'ghana',
  irak: 'iraq',
  meksiko: 'mexico',
  maroko: 'morocco',
  nizozemska: 'netherlands',
  novizeland: 'newzealand',
  norveska: 'norway',
  paragvaj: 'paraguay',
  katar: 'qatar',
  saudijskaarabija: 'saudiarabia',
  skotska: 'scotland',
  jar: 'southafrica',
  juznakoreja: 'korearepublic',
  spanjolska: 'spain',
  svedska: 'sweden',
  svicarska: 'switzerland',
  tunis: 'tunisia',
  turska: 'turkey',
  urugvaj: 'uruguay',
  sad: 'unitedstates',
};

/** Lowercase, strip diacritics + everything non-alphanumeric, then de-alias. */
export function normName(s: string): string {
  const base = s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return ALIASES[base] ?? base;
}

export interface Fixture {
  matchId: number;
  homeId: number;
  awayId: number;
  homeKey: string;
  awayKey: string;
  homeName: string;
  awayName: string;
  startTs: string | null;
}

let cache: Fixture[] | undefined;
let byPair: Map<string, Fixture> | undefined;

/** Load + index every WC2026 fixture once per process. Indexed by unordered team-key pair. */
export async function loadFixtures(): Promise<Fixture[]> {
  if (cache) return cache;
  const rows = await dbQuery<{
    ss_id: string;
    home_team_id: string | null;
    away_team_id: string | null;
    home_name: string | null;
    away_name: string | null;
    start_ts: string | null;
  }>(
    `select ss_id, home_team_id, away_team_id, home_name, away_name, start_ts
       from public.wc2026_match
      where home_team_id is not null and away_team_id is not null`,
  );
  cache = rows.map((r) => ({
    matchId: Number(r.ss_id),
    homeId: Number(r.home_team_id),
    awayId: Number(r.away_team_id),
    homeKey: normName(r.home_name ?? ''),
    awayKey: normName(r.away_name ?? ''),
    homeName: r.home_name ?? '',
    awayName: r.away_name ?? '',
    startTs: r.start_ts,
  }));
  byPair = new Map();
  for (const f of cache) {
    byPair.set(pairKey(f.homeKey, f.awayKey), f);
  }
  void WORLD_CUP;
  return cache;
}

/** Order-independent key so home/away orientation at the venue doesn't matter. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export interface FixtureMatch {
  fixture: Fixture;
  /** true when the venue's home == our home (else the venue listed teams swapped). */
  orientationSame: boolean;
}

/**
 * Resolve a venue event to a fixture. Tries exact normalized pair first, then a loose
 * containment match (venue strings sometimes carry extra words). Returns null if no
 * confident single match.
 */
export async function matchEvent(homeRaw: string, awayRaw: string): Promise<FixtureMatch | null> {
  await loadFixtures();
  const h = normName(homeRaw);
  const a = normName(awayRaw);
  if (!h || !a) return null;

  const exact = byPair!.get(pairKey(h, a));
  if (exact) {
    return { fixture: exact, orientationSame: exact.homeKey === h && exact.awayKey === a };
  }

  // loose: each venue token must contain or be contained by the fixture token
  const fits = (x: string, y: string): boolean => x === y || x.includes(y) || y.includes(x);
  const candidates = cache!.filter(
    (f) =>
      (fits(f.homeKey, h) && fits(f.awayKey, a)) || (fits(f.homeKey, a) && fits(f.awayKey, h)),
  );
  if (candidates.length === 1) {
    const f = candidates[0]!;
    return { fixture: f, orientationSame: fits(f.homeKey, h) && fits(f.awayKey, a) };
  }
  return null;
}

/** Reset the in-process cache (tests / long-running daemons). */
export function resetFixtureCache(): void {
  cache = undefined;
  byPair = undefined;
}
