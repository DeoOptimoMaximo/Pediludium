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
  nav: { overview: string; fixtures: string; groups: string; teams: string; predictions: string; forecast: string; movers: string; scorecard: string; bracket: string; accuracy: string; blog: string };
  bracket: {
    title: string;
    sub: string;
    progress: (played: number, total: number) => string;
    rounds: { r32: string; r16: string; qf: string; sf: string; final: string; third: string };
    tbd: string;
    winnerOf: (a: string, b: string) => string;
    ft: string;
    note: string;
  };
  blog: { title: string; sub: string; minRead: string; back: string };
  health: { stale: (count: number, at: Date) => string };
  ui: { toDark: string; toLight: string; toWide: string; toBoxed: string };
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
    croTitle: string;
    croSub: string;
    croNext: string;
    croProfile: string;
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
    wcResults: string;
    oddsTimeline: string;
    oddsTimelineNote: string;
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
  movers: {
    title: string;
    sub: (hours: number) => string;
    risers: string;
    fallers: string;
    quiet: string;
    metricAdvance: string;
    metricTitle: string;
    th: { team: string; grp: string; advance: string; title: string };
    note: string;
    empty: string;
  };
  scorecard: {
    title: string;
    sub: string;
    hits: (h: number, n: number, pct: number) => string;
    noneYet: string;
    th: { pred: string; result: string };
    noPred: string;
    correct: string;
    wrong: string;
    pick: (o: 0 | 1 | 2) => string;
    note: string;
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
    timeline: string;
    timelineNote: string;
  };
  accuracy: {
    title: string;
    sub: string;
    empty: string;
    explainer: string;
    summary: { model: string; matches: string; brier: string; logloss: string; naive: string };
    perMatch: string;
    chartTitle: string;
    chartNote: string;
    th: { date: string; match: string; pred: string; outcome: string; surprise: string; brier: string; logloss: string };
    outcomeName: (o: 0 | 1 | 2) => string;
    surpriseNote: string;
    report: {
      title: string;
      sub: (played: number) => string;
      th: { model: string; n: string; brier: string; logloss: string; skill: string; group: string; ko: string };
      skillNote: string;
      commonTitle: string;
      commonNote: (n: number) => string;
      marketTitle: string;
      marketNote: (n: number) => string;
      relTitle: string;
      relNote: string;
      relPredicted: string;
      relObserved: string;
      relCaption: (model: string) => string;
      surprisesTitle: string;
      surprisesNote: string;
      caveatsTitle: string;
      caveats: string[];
    };
  };
}

export const T: Record<Lang, Dict> = {
  hr: {
    locale: 'hr-HR',
    nav: { overview: 'Pregled', fixtures: 'Raspored', groups: 'Skupine', teams: 'Momčadi', predictions: 'Predikcije', forecast: 'Prognoza', movers: 'Pomaci', scorecard: 'Pogodci', bracket: 'Ljestvica', accuracy: 'Točnost', blog: 'Blog' },
    bracket: {
      title: 'Eliminacijska faza',
      sub: 'Put do naslova — od šesnaestine finala do finala, slijeva nadesno. Parovi se popunjavaju kako se utakmice igraju.',
      progress: (p, n) => `Šesnaestina finala: ${p}/${n} odigrano`,
      rounds: {
        r32: 'Šesnaestina finala',
        r16: 'Osmina finala',
        qf: 'Četvrtfinale',
        sf: 'Polufinale',
        final: 'Finale',
        third: 'Za 3. mjesto',
      },
      tbd: 'Još neodređeno',
      winnerOf: (a, b) => `Pobjednik ${a}/${b}`,
      ft: 'Kraj',
      note: 'Kasniji se krugovi popunjavaju automatski kako pobjednici budu poznati. Klik na utakmicu otvara detalje i predikciju.',
    },
    blog: {
      title: 'Blog — tehničke analize',
      sub: 'Kako model zapravo računa. Otvorene, matematički potkrijepljene analize iza svake predikcije i izgleda turnira.',
      minRead: 'min čitanja',
      back: 'Natrag na blog',
    },
    ui: { toDark: 'Tamna tema', toLight: 'Svijetla tema', toWide: 'Puna širina', toBoxed: 'Sužena širina' },
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
    health: {
      stale: (count, at) =>
        `Podaci kasne: ${count} odigran${count === 1 ? 'a utakmica' : 'e utakmice'} još ${count === 1 ? 'čeka' : 'čekaju'} rezultat. ` +
        `Zadnja provjera ${at.toUTCString().slice(5, 22)} UTC.`,
    },
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
      croTitle: 'Hrvatska',
      croSub: 'Naša reprezentacija na Svjetskom prvenstvu',
      croNext: 'Sljedeća utakmica',
      croProfile: 'Profil i kronologija izgleda →',
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
      wcResults: 'Svjetsko prvenstvo 2026 — odigrano',
      oddsTimeline: 'Izgledi kroz vrijeme',
      oddsTimelineNote:
        'Kako se Monte-Carlo prognoza turnira mijenja iz sata u sat kako stižu novi rezultati i model se ponovno trenira. Ravna linija = prognoza se nije mijenjala.',
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
    movers: {
      title: 'Najveći pomaci',
      sub: (h) => `Promjena izgleda u zadnjih ${h} h · kako rezultati pomiču prognozu`,
      risers: 'Skokovi',
      fallers: 'Padovi',
      quiet: 'Mirno — prognoza se gotovo nije pomakla',
      metricAdvance: 'Prolazak',
      metricTitle: 'Naslov',
      th: { team: 'Momčad', grp: 'Sk', advance: 'Prolazak', title: 'Naslov' },
      note: 'Svaki sat Monte-Carlo simulacija se ponovno vrti na svježim rezultatima. Ovdje je razlika između posljednje prognoze i one od prije 24 sata: zeleno = izgledi rastu, crveno = padaju. Prije početka turnira pomaci su sićušni jer još nema rezultata — tablica oživi čim utakmice krenu.',
      empty: 'Još nema dovoljno povijesti za usporedbu. Pomaci se pojave nakon nekoliko sati snimaka prognoze.',
    },
    scorecard: {
      title: 'Pogodci',
      sub: 'Sve utakmice kronološki. Za odigrane uspoređujemo predikciju zamrznutu prije početka sa stvarnim ishodom (1-X-2).',
      hits: (h, n, pct) => `pogođeno ${h}/${n} ishoda (${pct}%)`,
      noneYet: 'Još nema odigranih utakmica za ocjenu. Tablica oživi čim padnu prvi rezultati.',
      th: { pred: 'Predikcija', result: 'Ishod' },
      noPred: 'bez predikcije',
      correct: 'pogođen ishod',
      wrong: 'promašen ishod',
      pick: (o) => (o === 0 ? '1' : o === 1 ? 'X' : '2'),
      note: 'Predikcija = najvjerojatniji ishod (1 domaćin / X neriješeno / 2 gost) iz Dixon-Coles modela, zamrznut na posljednjem satnom izračunu prije početka utakmice. ✓ = model je pogodio klasifikaciju ishoda, ✗ = promašio. Ovo je gruba „pogodak/promašaj" mjera; za kalibraciju vjerojatnosti (Brier / log-loss) vidi Točnost.',
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
      timeline: 'Kronologija predikcije',
      timelineNote:
        'Satni izračuni od prvog snapshota do početka utakmice. Stepenasta linija drži vrijednost dok je model ne promijeni — ravno znači da model nije mijenjao mišljenje.',
    },
    accuracy: {
      title: 'Točnost modela',
      sub: 'Svaka predikcija zamrzava se prije početka utakmice, a nakon rezultata ocjenjuje — jesu li modeli istiniti ili je jednostavno: lopta je okrugla?',
      empty:
        'Još nema završenih utakmica za ocjenjivanje. Čim padnu prvi rezultati, ovdje kreće usporedba modela: Brier i log-loss po utakmici i kroz vrijeme.',
      explainer:
        'Brier (0 najbolje, 2 najgore): zbroj kvadrata razlika između predikcije i ishoda; nasumično pogađanje (⅓-⅓-⅓) daje 0,667. Log-loss kažnjava samouvjerene promašaje; nasumično = 1,099. Niže je bolje kod oba.',
      summary: { model: 'Model', matches: 'Utakmice', brier: 'Brier (prosjek)', logloss: 'Log-loss (prosjek)', naive: 'nasumično' },
      perMatch: 'Po utakmici',
      chartTitle: 'Brier kroz vrijeme (kumulativni prosjek)',
      chartNote: 'Svaka točka = stanje nakon ocjene još jedne utakmice. Ispod sive linije (0,667) model je bolji od nasumičnog pogađanja.',
      th: { date: 'Datum', match: 'Utakmica', pred: 'Predikcija 1-X-2', outcome: 'Ishod', surprise: 'Iznenađenje', brier: 'Brier', logloss: 'Log-loss' },
      outcomeName: (o) => (o === 0 ? '1 (domaćin)' : o === 1 ? 'X (neriješeno)' : '2 (gost)'),
      surpriseNote:
        'Boja retka pokazuje koliko se stvarni ishod razlikuje od predikcije: zeleno = model je stvarnom ishodu dao visoku vjerojatnost (očekivano), crveno = nisku (iznenađenje). Postotak je vjerojatnost koju je model dao onome što se zaista dogodilo.',
      report: {
        title: 'Završni obračun turnira',
        sub: (played) =>
          `Turnir je odigran do kraja — svih ${played} utakmica ocijenjeno. Ovo je konačni račun: koliko je koji model stvarno znao, gdje je pogriješio i je li uopće bio bolji od pogađanja.`,
        th: { model: 'Model', n: 'n', brier: 'Brier', logloss: 'Log-loss', skill: 'Vještina', group: 'Grupe', ko: 'Knockout' },
        skillNote:
          'Vještina = koliko je model bolji od nasumičnog pogađanja (0 = nimalo, 1 = savršeno, ispod 0 = gori od pogađanja). Stupci „Grupe" i „Knockout" su Brier unutar te faze.',
        commonTitle: 'Pošteno, jedan prema jedan',
        commonNote: (n) =>
          `Gornja tablica uspoređuje modele na različitim skupovima utakmica — dc-market-v1 uveden je usred turnira, pa ima manje predikcija. Ovdje su svi ocijenjeni na istih ${n} utakmica koje su svi predviđali. Ovo je jedina brojka po kojoj ih se smije rangirati.`,
        marketTitle: 'Protiv kladionice',
        marketNote: (n) =>
          `Kvote su ocijenjene isto kao i model — zamrznute prije početka, preračunate u vjerojatnosti. Uzorak je mršav (${n} utakmica, sve iz grupne faze) jer nam je dohvat kvota otpao rano u turniru, pa je ovo indikacija, ne presuda.`,
        relTitle: 'Kalibracija — znači li 30% zaista 30%',
        relNote:
          'Svaka predikcija daje tri vjerojatnosti (1, X, 2). Grupirane su po visini i uspoređene sa stvarnom učestalošću. Točka na isprekidanoj dijagonali = savršeno kalibrirano. Iznad = model je bio prestrašljiv, ispod = presamouvjeren. Veličina točke = koliko je predikcija u toj skupini.',
        relPredicted: 'predviđeno',
        relObserved: 'stvarno',
        relCaption: (model) => `Kalibracija — ${model}`,
        surprisesTitle: 'Najveća iznenađenja',
        surprisesNote: 'Utakmice kojima je model dao najnižu vjerojatnost onome što se na kraju dogodilo.',
        caveatsTitle: 'Što s ovim brojkama nije u redu',
        caveats: [
          'Simulacijska povijest (izgledi za naslov kroz turnir) bila je DJELOMIČNO NEKONDICIONIRANA: slotovi knockouta pinali su se iz sirovih imena momčadi, koja su ostajala ustajala dok je mobilni proxy bio mrtav, a odigrane knockout utakmice simulirale su se iznova. Popravljeno je tek 20. srpnja 2026., nakon finala. Predikcije po utakmici (ova stranica) time nisu zahvaćene — one se zamrzavaju prije početka i nikad se ne prepisuju — ali serije izgleda za naslov iz sredine turnira treba čitati s rezervom.',
          'Baza je kroz turnir imala 18 tihih ispada (najdulji ~6 dana), pa neke utakmice nisu dobile predikciju u zadnjem satu prije početka; za njih je ocijenjena zadnja ranija zamrznuta predikcija.',
          'Uzorak je 104 utakmice. Razlika u Brieru od nekoliko tisućinki između modela nije statistički značajna i ne treba je čitati kao poredak.',
        ],
      },
    },
  },
  en: {
    locale: 'en-GB',
    nav: { overview: 'Overview', fixtures: 'Fixtures', groups: 'Groups', teams: 'Teams', predictions: 'Predictions', forecast: 'Forecast', movers: 'Movers', scorecard: 'Scorecard', bracket: 'Bracket', accuracy: 'Accuracy', blog: 'Blog' },
    bracket: {
      title: 'Knockout bracket',
      sub: 'The road to the title — round of 32 through the final, left to right. Ties fill in as matches are played.',
      progress: (p, n) => `Round of 32: ${p}/${n} played`,
      rounds: {
        r32: 'Round of 32',
        r16: 'Round of 16',
        qf: 'Quarter-finals',
        sf: 'Semi-finals',
        final: 'Final',
        third: 'Third place',
      },
      tbd: 'To be decided',
      winnerOf: (a, b) => `Winner ${a}/${b}`,
      ft: 'FT',
      note: 'Later rounds fill in automatically as winners are decided. Tap a match for details and the prediction.',
    },
    blog: {
      title: 'Blog — technical write-ups',
      sub: 'How the model actually computes. Open, math-backed analyses behind every prediction and tournament odd.',
      minRead: 'min read',
      back: 'Back to blog',
    },
    ui: { toDark: 'Dark theme', toLight: 'Light theme', toWide: 'Full width', toBoxed: 'Boxed width' },
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
    health: {
      stale: (count, at) =>
        `Data is behind: ${count} played match${count === 1 ? '' : 'es'} still awaiting a result. ` +
        `Last checked ${at.toUTCString().slice(5, 22)} UTC.`,
    },
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
      croTitle: 'Croatia',
      croSub: 'Our national team at the World Cup',
      croNext: 'Next match',
      croProfile: 'Profile & odds timeline →',
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
      wcResults: 'World Cup 2026 — played',
      oddsTimeline: 'Odds over time',
      oddsTimelineNote:
        'How the Monte-Carlo tournament forecast moves hour by hour as new results arrive and the model refits. A flat line means the forecast held steady.',
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
    movers: {
      title: 'Biggest movers',
      sub: (h) => `Odds change over the last ${h} h · how results swing the forecast`,
      risers: 'Risers',
      fallers: 'Fallers',
      quiet: 'Quiet — the forecast barely moved',
      metricAdvance: 'Advance',
      metricTitle: 'Title',
      th: { team: 'Team', grp: 'Grp', advance: 'Advance', title: 'Title' },
      note: 'Every hour the Monte-Carlo simulation refits on fresh results. This is the difference between the latest forecast and the one 24 hours earlier: green = odds rising, red = falling. Before the tournament the moves are tiny because there are no results yet — the table comes alive once matches kick off.',
      empty: 'Not enough history to compare yet. Movers appear after a few hours of forecast snapshots.',
    },
    scorecard: {
      title: 'Scorecard',
      sub: 'Every match in order. For played matches we compare the prediction frozen before kick-off against the actual outcome (1-X-2).',
      hits: (h, n, pct) => `${h}/${n} outcomes called (${pct}%)`,
      noneYet: 'No played matches to score yet. The table comes alive once the first results land.',
      th: { pred: 'Prediction', result: 'Outcome' },
      noPred: 'no prediction',
      correct: 'outcome called',
      wrong: 'outcome missed',
      pick: (o) => (o === 0 ? '1' : o === 1 ? 'X' : '2'),
      note: 'Prediction = the most likely outcome (1 home / X draw / 2 away) from the Dixon-Coles model, frozen at the last hourly recompute before kick-off. ✓ = the model called the outcome class, ✗ = missed. This is a coarse hit/miss measure; for probability calibration (Brier / log-loss) see Accuracy.',
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
      timeline: 'Prediction timeline',
      timelineNote:
        'Hourly recomputes from the first snapshot until kick-off. The step line holds a value until the model changes its mind — flat means it never did.',
    },
    accuracy: {
      title: 'Model accuracy',
      sub: 'Every prediction is frozen before kick-off and scored once the result is in — are the models truthful, or is it simply: the ball is round?',
      empty:
        'No finished matches to score yet. As soon as the first results land, the model comparison starts here: Brier and log-loss per match and over time.',
      explainer:
        'Brier (0 best, 2 worst): sum of squared differences between prediction and outcome; random guessing (⅓-⅓-⅓) scores 0.667. Log-loss punishes confident misses; random = 1.099. Lower is better for both.',
      summary: { model: 'Model', matches: 'Matches', brier: 'Brier (mean)', logloss: 'Log-loss (mean)', naive: 'random' },
      perMatch: 'Per match',
      chartTitle: 'Brier over time (cumulative mean)',
      chartNote: 'Each point = the running average after scoring one more match. Below the grey line (0.667) the model beats random guessing.',
      th: { date: 'Date', match: 'Match', pred: 'Prediction 1-X-2', outcome: 'Outcome', surprise: 'Surprise', brier: 'Brier', logloss: 'Log-loss' },
      outcomeName: (o) => (o === 0 ? '1 (home)' : o === 1 ? 'X (draw)' : '2 (away)'),
      surpriseNote:
        'Row colour shows how far the actual outcome was from the prediction: green = the model gave the actual result a high probability (expected), red = a low one (a surprise). The percentage is the probability the model assigned to what actually happened.',
      report: {
        title: 'Final reckoning',
        sub: (played) =>
          `The tournament is over — all ${played} matches scored. This is the final account: how much each model actually knew, where it was wrong, and whether it beat guessing at all.`,
        th: { model: 'Model', n: 'n', brier: 'Brier', logloss: 'Log-loss', skill: 'Skill', group: 'Groups', ko: 'Knockout' },
        skillNote:
          'Skill = how much better than random guessing (0 = not at all, 1 = perfect, below 0 = worse than guessing). The “Groups” and “Knockout” columns are the Brier score within that phase.',
        commonTitle: 'Like for like',
        commonNote: (n) =>
          `The table above compares models scored on different sets of matches — dc-market-v1 was introduced mid-tournament, so it has fewer predictions. Here they are all scored on the same ${n} matches that every one of them predicted. This is the only number you may rank them by.`,
        marketTitle: 'Against the bookmaker',
        marketNote: (n) =>
          `The odds are scored exactly like a model — frozen before kick-off, converted to probabilities. The sample is thin (${n} matches, all from the group stage) because our odds feed dropped out early in the tournament, so treat this as an indication, not a verdict.`,
        relTitle: 'Calibration — does 30% really mean 30%',
        relNote:
          'Every prediction gives three probabilities (1, X, 2). They are bucketed by size and compared against how often they actually happened. A point on the dashed diagonal = perfectly calibrated. Above it the model was too timid, below it too confident. Dot size = how many predictions sit in that bucket.',
        relPredicted: 'predicted',
        relObserved: 'observed',
        relCaption: (model) => `Calibration — ${model}`,
        surprisesTitle: 'Biggest surprises',
        surprisesNote: 'The matches where the model gave the lowest probability to what actually happened.',
        caveatsTitle: 'What is wrong with these numbers',
        caveats: [
          'The simulation history (title odds through the tournament) was PARTIALLY UNCONDITIONED: knockout slots were pinned from raw team names, which went stale while the mobile proxy was dead, and knockout matches already played were re-simulated. This was only fixed on 20 July 2026, after the final. The per-match predictions on this page are unaffected — those are frozen before kick-off and never overwritten — but mid-tournament title-odds series should be read with caution.',
          'The database suffered 18 silent outages during the tournament (the longest ~6 days), so some matches got no prediction in the final hour before kick-off; for those, the last earlier frozen prediction was scored.',
          'The sample is 104 matches. A Brier difference of a few thousandths between models is not statistically significant and should not be read as a ranking.',
        ],
      },
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
