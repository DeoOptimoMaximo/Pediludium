/**
 * Lightweight i18n — Croatian (default) + English. No library: a typed dictionary per
 * language, picked by the `lang` cookie (see lib/lang.ts). Pure data — safe to import
 * from both server and client components.
 */

export type Lang = 'hr' | 'en';
export const DEFAULT_LANG: Lang = 'hr';
export const LANGS: Lang[] = ['hr', 'en'];

export interface Dict {
  locale: string;
  nav: { overview: string; fixtures: string; groups: string; teams: string; predictions: string; forecast: string };
  common: {
    live: string;
    finished: string;
    scheduled: string;
    notPlayed: string;
    tbd: string;
    dateTbd: string;
    unknown: string;
    home: string;
    draw: string;
    away: string;
    knockout: string;
    model: string;
    soon: string;
    homeShort: string; // venue letter
    awayShort: string;
  };
  countdown: [string, string, string, string];
  ticker: { connecting: string; none: string; live: (n: number) => string };
  homePage: {
    kicker: string;
    tagline: string;
    kickOff: string;
    dataAsOf: string;
    btnFixtures: string;
    btnGroups: string;
    btnPredictions: string;
    nextUp: string;
    powerRanking: string;
    powerRankingSub: string;
    note: string;
  };
  fixtures: { title: string; sub: (n: number) => string };
  groups: {
    title: string;
    intro: string;
    advExplainer: [string, string, string]; // [before <b>Adv</b>, between, link label]
    ladderTitle: string;
    ladderIntro: string;
    cutoff: string;
    tierWinners: string;
    tierRunners: string;
    tierThirds: string;
    tierFourths: string;
    tagAdvance: (n: number) => string;
    tagOut: (n: number) => string;
    th: { team: string; grp: string; p: string; w: string; d: string; l: string; gf: string; ga: string; gd: string; pts: string; adv: string };
  };
  teams: { title: string; sub: (n: number) => string };
  team: {
    back: string;
    matches: string;
    wdl: string;
    winRate: string;
    goals: string;
    recentForm: string;
    historyLoading: string;
    upcoming: string;
    present: string;
  };
  predictions: {
    title: string;
    sub: (n: number) => string;
    note: string;
  };
  simulation: {
    title: string;
    sub: (iters: string) => string;
    th: { team: string; grp: string; winGrp: string; advance: string; semis: string; winCup: string };
    note: (iters: string) => string;
  };
  match: {
    backFixtures: string;
    prediction: string;
    noPrediction: string;
    expGoals: string;
    facts: string;
    kickOff: string;
    stage: string;
    status: string;
    statusOf: (s: string | null) => string;
    h2h: string;
    h2hSoon: string;
    liveStats: string;
    liveStatsSoon: string;
    advanced: string;
    advancedText: [string, string, string]; // [before link, link label, after]
    date: string;
    competition: string;
    round: string;
    result: string;
    histStatsTitle: string;
    histStatsSoon: string;
  };
}

export const T: Record<Lang, Dict> = {
  hr: {
    locale: 'hr-HR',
    nav: { overview: 'Pregled', fixtures: 'Raspored', groups: 'Skupine', teams: 'Momčadi', predictions: 'Predikcije', forecast: 'Prognoza' },
    common: {
      live: 'UŽIVO',
      finished: 'Završeno',
      scheduled: 'Zakazano',
      notPlayed: 'Nije odigrana',
      tbd: 'TBD',
      dateTbd: 'Datum nepoznat',
      unknown: 'Nepoznato',
      home: 'Domaćin',
      draw: 'Neriješeno',
      away: 'Gost',
      knockout: 'Nokaut faza',
      model: 'Model',
      soon: 'USKORO',
      homeShort: 'D',
      awayShort: 'G',
    },
    countdown: ['DANA', 'SATI', 'MIN', 'SEK'],
    ticker: { connecting: 'povezivanje…', none: 'nema utakmica uživo', live: (n) => `● ${n} uživo` },
    homePage: {
      kicker: 'Svjetsko prvenstvo 2026. · SAD · Kanada · Meksiko',
      tagline:
        'Otvorena nogometna analitika za Svjetsko prvenstvo s 48 reprezentacija: Dixon-Coles predikcije utakmica i Monte-Carlo izgledi turnira. Jer i najbolji modeli imaju iznimke — lopta je okrugla.',
      kickOff: 'Početak',
      dataAsOf: 'Podaci',
      btnFixtures: 'Sve utakmice',
      btnGroups: 'Skupine i poredak',
      btnPredictions: 'Predikcije',
      nextUp: 'Slijedi',
      powerRanking: 'Ljestvica snage · Elo',
      powerRankingSub: 'Rejting forme iz povijesti utakmica (osnovni model).',
      note: 'Predikcije su transparentni statistički modeli: Elo + Poisson osnova i Dixon-Coles nadogradnja, a izgledi prolaska i naslova dolaze iz Monte-Carlo simulacije cijelog turnira.',
    },
    fixtures: { title: 'Raspored', sub: (n) => `${n} utakmica · sva vremena po Zagrebu` },
    groups: {
      title: 'Skupine i poredak',
      intro: '12 skupina po 4. Tablice se ažuriraju uživo kad utakmice krenu (prije turnira sve je 0).',
      advExplainer: ['', '= šansa prolaska u šesnaestinu finala prema', 'prognozi'],
      ladderTitle: 'Skupine kao jedna liga',
      ladderIntro:
        'Svih 48 reprezentacija u jednoj među-skupinskoj tablici, grupirano po plasmanu u skupini i rangirano bodovima · gol-razlikom · golovima (prije turnira: Elo kao nositeljstvo). Prve dvije iz svake skupine plus 8 najboljih trećeplasiranih — ukupno 32 — prelaze crtu u šesnaestinu finala; 4 najslabije treće i svih 12 četvrtoplasiranih ispada.',
      cutoff: 'Granica prolaska — najboljih 32 ide dalje',
      tierWinners: 'Pobjednici skupina',
      tierRunners: 'Drugoplasirani',
      tierThirds: 'Trećeplasirani — najboljih 8',
      tierFourths: 'Četvrtoplasirani',
      tagAdvance: (n) => `prolaze · ${n}`,
      tagOut: (n) => `ispadaju · ${n}`,
      th: { team: 'Momčad', grp: 'Sk', p: 'U', w: 'P', d: 'N', l: 'I', gf: 'G+', ga: 'G−', gd: '±', pts: 'Bod', adv: 'Dalje' },
    },
    teams: { title: 'Momčadi', sub: (n) => `${n} reprezentacija · Elo rejting · klik za 10 godina povijesti` },
    team: {
      back: '← Momčadi',
      matches: 'utakmica',
      wdl: 'P-N-I',
      winRate: 'postotak pobjeda',
      goals: 'golovi',
      recentForm: 'forma (najnovije prvo)',
      historyLoading: 'Povijest utakmica još se učitava.',
      upcoming: 'Slijedi',
      present: 'SADA',
    },
    predictions: {
      title: 'Predikcije',
      sub: (n) => `${n} utakmica skupina`,
      note: 'Dixon-Coles (korekcija niskih rezultata + eksponencijalno vremensko ponderiranje, weighted MLE) radi usporedno s Elo + Poisson osnovom — prebaci gore. Oba modela pogone Monte-Carlo simulaciju turnira za izglede prolaska i naslova.',
    },
    simulation: {
      title: 'Prognoza turnira',
      sub: (iters) => `${iters} simuliranih turnira · prolazak skupine i izgledi za naslov`,
      th: { team: 'Momčad', grp: 'Sk', winGrp: '1. mjesto', advance: 'Dalje', semis: 'Polufinale', winCup: 'Naslov' },
      note: (iters) =>
        `Svaki turnir odigran je ${iters} puta: 72 utakmice skupina uzorkuju se iz Dixon-Coles modela golova, rangiraju FIFA-inim pravilima, osam najboljih trećeplasiranih prolazi, a kompletan ždrijeb od 32 momčadi rekonstruira se iz službenih slotova i igra do finala. Stupci za naslov skalirani su prema vodećem.`,
    },
    match: {
      backFixtures: '← Raspored',
      prediction: 'Predikcija',
      noPrediction: 'Nema predikcije (momčadi nokaut faze još nisu poznate).',
      expGoals: 'Očekivani golovi',
      facts: 'Detalji utakmice',
      kickOff: 'Početak',
      stage: 'Faza',
      status: 'Status',
      statusOf: (s) =>
        s === 'notstarted' ? 'nije počela' : s === 'inprogress' ? 'u tijeku' : s === 'finished' ? 'završena' : (s ?? '—'),
      h2h: 'Međusobni susreti',
      h2hSoon: 'Uskoro: nedavni međusobni susreti i ukupni omjer.',
      liveStats: 'Statistika uživo / xG',
      liveStatsSoon: 'Uskoro: posjed, udarci i xG kad utakmica krene.',
      advanced: 'Napredni model',
      advancedText: ['Dixon-Coles pogoni ovu predikciju; izgledi prolaska i naslova dolaze iz ', 'Monte-Carlo simulacije', '. Sljedeće: ponderiranje snage protivnika i kvota s tržišta.'],
      date: 'Datum',
      competition: 'Natjecanje',
      round: 'Kolo',
      result: 'Rezultat',
      histStatsTitle: 'Statistika / postave / događaji',
      histStatsSoon: 'Za povijesne utakmice još nije uvezeno — stiže naknadno.',
    },
  },
  en: {
    locale: 'en-GB',
    nav: { overview: 'Overview', fixtures: 'Fixtures', groups: 'Groups', teams: 'Teams', predictions: 'Predictions', forecast: 'Forecast' },
    common: {
      live: 'LIVE',
      finished: 'Finished',
      scheduled: 'Scheduled',
      notPlayed: 'Not played',
      tbd: 'TBD',
      dateTbd: 'Date TBD',
      unknown: 'Unknown',
      home: 'Home',
      draw: 'Draw',
      away: 'Away',
      knockout: 'Knockout',
      model: 'Model',
      soon: 'SOON',
      homeShort: 'H',
      awayShort: 'A',
    },
    countdown: ['D', 'H', 'M', 'S'],
    ticker: { connecting: 'connecting…', none: 'no matches live', live: (n) => `● ${n} live now` },
    homePage: {
      kicker: 'FIFA World Cup 2026 · USA · Canada · Mexico',
      tagline:
        'Open football analytics for the 48-team World Cup: Dixon-Coles match predictions and Monte-Carlo tournament odds. Because even the best models have exceptions — the ball is round.',
      kickOff: 'Kick-off',
      dataAsOf: 'Data',
      btnFixtures: 'All fixtures',
      btnGroups: 'Groups & standings',
      btnPredictions: 'Predictions',
      nextUp: 'Next up',
      powerRanking: 'Power ranking · Elo',
      powerRankingSub: 'Recent-form rating from match history (baseline).',
      note: 'Predictions are transparent statistical models: an Elo + Poisson baseline and a Dixon-Coles upgrade, with advance & title odds from a Monte-Carlo simulation of the whole tournament.',
    },
    fixtures: { title: 'Fixtures', sub: (n) => `${n} matches · all times Europe/Zagreb` },
    groups: {
      title: 'Groups & standings',
      intro: '12 groups of 4. Tables update live once matches kick off (all zeros pre-tournament).',
      advExplainer: ['', '= chance of reaching the Round of 32 from the', 'forecast'],
      ladderTitle: 'Group stage as one league',
      ladderIntro:
        'All 48 teams in a single cross-group table, banded by finishing position and ranked by points · goal difference · goals (pre-tournament: Elo seed). The top two of every group plus the 8 best third-placed teams — 32 in total — cross the line into the Round of 32; the bottom 4 thirds and all 12 fourth-placed teams are out.',
      cutoff: 'Round of 32 cutoff — top 32 qualify',
      tierWinners: 'Group winners',
      tierRunners: 'Runners-up',
      tierThirds: 'Third-placed — best 8',
      tierFourths: 'Fourth-placed',
      tagAdvance: (n) => `advance · ${n}`,
      tagOut: (n) => `eliminated · ${n}`,
      th: { team: 'Team', grp: 'Grp', p: 'P', w: 'W', d: 'D', l: 'L', gf: 'GF', ga: 'GA', gd: 'GD', pts: 'Pts', adv: 'Adv' },
    },
    teams: { title: 'Teams', sub: (n) => `${n} national teams · Elo rated · click for 10-year history` },
    team: {
      back: '← Teams',
      matches: 'matches',
      wdl: 'W-D-L',
      winRate: 'win rate',
      goals: 'goals',
      recentForm: 'recent form (newest first)',
      historyLoading: 'Match history is still loading.',
      upcoming: 'Upcoming',
      present: 'PRESENT',
    },
    predictions: {
      title: 'Predictions',
      sub: (n) => `${n} group-stage fixtures`,
      note: 'Dixon-Coles (low-score correction + exponential time-decay weighting, fitted by weighted MLE) runs alongside the Elo + Poisson baseline — switch above. Both feed a Monte-Carlo tournament simulation for advance & title odds.',
    },
    simulation: {
      title: 'Tournament forecast',
      sub: (iters) => `${iters} simulated tournaments · group-advance & title odds`,
      th: { team: 'Team', grp: 'Grp', winGrp: 'Win grp', advance: 'Advance', semis: 'Semis', winCup: 'Win cup' },
      note: (iters) =>
        `Each tournament is played out ${iters} times: 72 group matches are sampled from the Dixon-Coles goal model, ranked with FIFA tie-breakers, the eight best third-placed teams qualify, and the full 32-team bracket is reconstructed from the official fixture slots and played to the final. Win-cup bars are scaled to the leader.`,
    },
    match: {
      backFixtures: '← Fixtures',
      prediction: 'Prediction',
      noPrediction: 'No prediction (knockout teams not decided yet).',
      expGoals: 'Expected goals',
      facts: 'Match facts',
      kickOff: 'Kick-off',
      stage: 'Stage',
      status: 'Status',
      statusOf: (s) =>
        s === 'notstarted' ? 'not started' : s === 'inprogress' ? 'in progress' : s === 'finished' ? 'finished' : (s ?? '—'),
      h2h: 'Head-to-head',
      h2hSoon: 'Coming soon: recent meetings & aggregate record.',
      liveStats: 'Live stats / xG',
      liveStatsSoon: 'Coming soon: possession, shots and xG once the match is live.',
      advanced: 'Advanced model',
      advancedText: ['Dixon-Coles powers this prediction; tournament advance & title odds come from a ', 'Monte-Carlo simulation', '. Next: opponent-strength weighting & a market-odds blend.'],
      date: 'Date',
      competition: 'Competition',
      round: 'Round',
      result: 'Result',
      histStatsTitle: 'Stats / lineups / incidents',
      histStatsSoon: 'Not yet ingested for historical matches — coming later.',
    },
  },
};

/** Croatian names for national teams, keyed by the alpha2 code carried in our data. */
const HR_TEAM: Record<string, string> = {
  AD: 'Andora', AE: 'Ujedinjeni Arapski Emirati', AF: 'Afganistan', AG: 'Antigva i Barbuda', AL: 'Albanija',
  AM: 'Armenija', AO: 'Angola', AR: 'Argentina', AT: 'Austrija', AU: 'Australija', AZ: 'Azerbajdžan',
  BA: 'Bosna i Hercegovina', BB: 'Barbados', BD: 'Bangladeš', BE: 'Belgija', BF: 'Burkina Faso', BG: 'Bugarska',
  BH: 'Bahrein', BI: 'Burundi', BJ: 'Benin', BM: 'Bermudi', BO: 'Bolivija', BR: 'Brazil', BS: 'Bahami',
  BW: 'Bocvana', BY: 'Bjelorusija', BZ: 'Belize', CA: 'Kanada', CD: 'DR Kongo', CF: 'Srednjoafrička Republika',
  CG: 'Kongo', CH: 'Švicarska', CI: 'Obala Bjelokosti', CL: 'Čile', CM: 'Kamerun', CN: 'Kina', CO: 'Kolumbija',
  CR: 'Kostarika', CU: 'Kuba', CV: 'Zelenortska Republika', CW: 'Curaçao', CY: 'Cipar', CZ: 'Češka',
  DE: 'Njemačka', DJ: 'Džibuti', DK: 'Danska', DM: 'Dominika', DO: 'Dominikanska Republika', DZ: 'Alžir',
  EC: 'Ekvador', EE: 'Estonija', EG: 'Egipat', EN: 'Engleska', ER: 'Eritreja', ES: 'Španjolska', ET: 'Etiopija',
  FI: 'Finska', FJ: 'Fidži', FO: 'Farski otoci', FR: 'Francuska', GA: 'Gabon', GB: 'Velika Britanija',
  GD: 'Grenada', GE: 'Gruzija', GH: 'Gana', GI: 'Gibraltar', GM: 'Gambija', GN: 'Gvineja',
  GQ: 'Ekvatorska Gvineja', GR: 'Grčka', GT: 'Gvatemala', GW: 'Gvineja Bisau', GY: 'Gvajana', HN: 'Honduras',
  HR: 'Hrvatska', HT: 'Haiti', HU: 'Mađarska', ID: 'Indonezija', IE: 'Irska', IL: 'Izrael', IN: 'Indija',
  IQ: 'Irak', IR: 'Iran', IS: 'Island', IT: 'Italija', JM: 'Jamajka', JO: 'Jordan', JP: 'Japan', KE: 'Kenija',
  KG: 'Kirgistan', KH: 'Kambodža', KM: 'Komori', KN: 'Sveti Kristofor i Nevis', KP: 'Sjeverna Koreja',
  KR: 'Južna Koreja', KW: 'Kuvajt', KZ: 'Kazahstan', LA: 'Laos', LB: 'Libanon', LC: 'Sveta Lucija',
  LI: 'Lihtenštajn', LK: 'Šri Lanka', LR: 'Liberija', LS: 'Lesoto', LT: 'Litva', LU: 'Luksemburg', LV: 'Latvija',
  LY: 'Libija', MA: 'Maroko', MC: 'Monako', MD: 'Moldavija', ME: 'Crna Gora', MG: 'Madagaskar',
  MK: 'Sjeverna Makedonija', ML: 'Mali', MM: 'Mjanmar', MN: 'Mongolija', MR: 'Mauritanija', MT: 'Malta',
  MU: 'Mauricijus', MV: 'Maldivi', MW: 'Malavi', MX: 'Meksiko', MY: 'Malezija', MZ: 'Mozambik', NA: 'Namibija',
  NE: 'Niger', NG: 'Nigerija', NI: 'Nikaragva', NL: 'Nizozemska', NO: 'Norveška', NP: 'Nepal', NZ: 'Novi Zeland',
  OM: 'Oman', PA: 'Panama', PE: 'Peru', PG: 'Papua Nova Gvineja', PH: 'Filipini', PK: 'Pakistan', PL: 'Poljska',
  PS: 'Palestina', PT: 'Portugal', PY: 'Paragvaj', QA: 'Katar', RO: 'Rumunjska', RS: 'Srbija', RU: 'Rusija',
  RW: 'Ruanda', SA: 'Saudijska Arabija', SB: 'Salomonski Otoci', SC: 'Sejšeli', SD: 'Sudan', SE: 'Švedska',
  SG: 'Singapur', SI: 'Slovenija', SK: 'Slovačka', SL: 'Sijera Leone', SM: 'San Marino', SN: 'Senegal',
  SO: 'Somalija', SR: 'Surinam', SS: 'Južni Sudan', SV: 'Salvador', SX: 'Škotska', SY: 'Sirija', SZ: 'Esvatini',
  TD: 'Čad', TG: 'Togo', TH: 'Tajland', TJ: 'Tadžikistan', TM: 'Turkmenistan', TN: 'Tunis', TR: 'Turska',
  TT: 'Trinidad i Tobago', TW: 'Tajvan', TZ: 'Tanzanija', UA: 'Ukrajina', UG: 'Uganda', US: 'SAD',
  UY: 'Urugvaj', UZ: 'Uzbekistan', VE: 'Venezuela', VN: 'Vijetnam', WA: 'Wales', XK: 'Kosovo', YE: 'Jemen',
  ZA: 'Južnoafrička Republika', ZM: 'Zambija', ZW: 'Zimbabve',
};

/** Display name for a team: Croatian exonym when we have one, source name otherwise. */
export function teamName(name: string | null | undefined, alpha2: string | null | undefined, lang: Lang): string | null {
  if (lang === 'hr' && alpha2) {
    const hr = HR_TEAM[alpha2.toUpperCase()];
    if (hr) return hr;
  }
  return name ?? null;
}

/** "Group A" → "Skupina A" in Croatian; pass-through otherwise. */
export function groupLabel(name: string | null | undefined, lang: Lang): string | null {
  if (!name) return null;
  return lang === 'hr' ? name.replace(/^Group\s/, 'Skupina ') : name;
}

/** W/D/L result letter localized for badges (classes stay W/D/L). */
export function resultLetter(result: 'W' | 'D' | 'L' | null, lang: Lang): string {
  if (!result) return '';
  if (lang === 'hr') return result === 'W' ? 'P' : result === 'D' ? 'N' : 'I';
  return result;
}
