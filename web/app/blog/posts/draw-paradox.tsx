import type { Lang } from '@/lib/i18n';
import { Mermaid } from '../../components/Mermaid';
import { ScoreMatrix } from '../../components/ScoreMatrix';

/**
 * Post: "Why no prediction ever favours a draw." The technical centrepiece of the blog —
 * derives from the Dixon-Coles scoreline matrix why the draw diagonal is always outnumbered,
 * using two live SVG heatmaps (real model math) + Mermaid flow/pie diagrams.
 */

const PIPELINE = (l: Lang) =>
  l === 'hr'
    ? `flowchart LR
  H["napad/obrana<br/>domaćina"] --> L["λ = exp(att_h − def_a + γ)"]
  A["napad/obrana<br/>gosta"] --> M["μ = exp(att_a − def_h)"]
  L --> G["matrica rezultata P(i,j)"]
  M --> G
  G --> P["P(i,j) = Poisson(i;λ)·Poisson(j;μ)·τ(i,j)"]
  P --> O{"zbroj po regijama"}
  O -->|"i &gt; j"| Ph["p_home (1)"]
  O -->|"i = j"| Pd["p_draw (X)"]
  O -->|"i &lt; j"| Pa["p_away (2)"]`
    : `flowchart LR
  H["home<br/>attack/defence"] --> L["λ = exp(att_h − def_a + γ)"]
  A["away<br/>attack/defence"] --> M["μ = exp(att_a − def_h)"]
  L --> G["scoreline matrix P(i,j)"]
  M --> G
  G --> P["P(i,j) = Poisson(i;λ)·Poisson(j;μ)·τ(i,j)"]
  P --> O{"sum by region"}
  O -->|"i &gt; j"| Ph["p_home (1)"]
  O -->|"i = j"| Pd["p_draw (X)"]
  O -->|"i &lt; j"| Pa["p_away (2)"]`;

const PIE = (l: Lang) =>
  l === 'hr'
    ? `pie showData
  title Canada–BiH — predikcija ishoda
  "1 — pobjeda Kanade" : 61.8
  "X — neriješeno" : 20.6
  "2 — pobjeda BiH" : 17.6`
    : `pie showData
  title Canada–BiH — outcome prediction
  "1 — Canada win" : 61.8
  "X — draw" : 20.6
  "2 — BiH win" : 17.6`;

export function DrawParadox({ lang }: { lang: Lang }) {
  return lang === 'hr' ? <Hr /> : <En />;
}

function Hr() {
  return (
    <div className="prose">
      <p className="lead">
        Pogledaš sve predikcije za sve utakmice i shvatiš: <b>niti jedna ne predviđa neriješeno</b> kao
        najvjerojatniji ishod. Djeluje nerealno. Nije — matematički je neizbježno. Evo zašto, izvedeno iz
        prve linije koda modela.
      </p>

      <h2>1. Model ne bira pobjednika — gradi distribuciju</h2>
      <p>
        Dixon-Coles ne predviđa „pobjednika”. Iz snage napada i obrane svake momčadi izračuna{' '}
        <b>očekivane golove</b> — λ za domaćina, μ za gosta — pa iz njih sastavi cijelu{' '}
        <b>matricu rezultata</b>: vjerojatnost svakog mogućeg ishoda 0:0, 1:0, 2:1… Tek na kraju zbroji te
        ćelije u tri brojke: 1, X, 2.
      </p>
      <Mermaid chart={PIPELINE('hr')} caption="Lanac izračuna: snage → λ, μ → matrica → ishod (model.ts)." />

      <h2>2. Remi je jedna tanka linija, pobjede su dvije pune polovice</h2>
      <p>
        Ishod je samo zbroj ćelija matrice po regijama. Pobjeda domaćina = <b>cijeli trokut ispod</b>{' '}
        dijagonale (zabio više). Pobjeda gosta = <b>cijeli trokut iznad</b>. A neriješeno? Samo{' '}
        <b>dijagonala</b> — 0:0, 1:1, 2:2… Jedna linija ćelija protiv dvije pune polovice.
      </p>
      <p>
        Boja u mreži ispod je regija ishoda, jačina boje je vjerojatnost rezultata. Ovo je prava utakmica —
        Canada 1:1 BiH, gdje je model računao λ=2.10, μ=1.03:
      </p>
      <ScoreMatrix lambda={2.1} mu={1.03} homeLabel="1 Canada" awayLabel="2 BiH" />
      <p className="muted small">
        Dijagonala (obrubljena) skuplja samo 20.6% mase; trokut domaćina 61.8%. Model je rekao „1”, palo je
        „X” — ali remi nije bio nemoguć, dobio je svaki peti udio.
      </p>

      <h2>3. Čak i kod savršeno izjednačenih momčadi remi gubi</h2>
      <p>
        Logična pomisao: ako su momčadi jednake (λ = μ), remi mora biti favorit. Nije. Masa se razlije po{' '}
        <i>obje</i> simetrične polovice, a dijagonala pokupi samo ono što „pogodi” istu brojku s obje strane.
        Pri ligaškom prosjeku našeg modela (1.35 gola po momčadi) savršeno izjednačena utakmica daje:
      </p>
      <ScoreMatrix lambda={1.35} mu={1.35} homeLabel="1" awayLabel="2" />
      <p className="muted small">
        0.369 / 0.261 / 0.369 — remi gubi od <i>obje</i> strane istovremeno. Tek kad oba očekivana gola padnu
        ispod ~0.9 (utakmice s vrlo malo golova), dijagonala prijeđe ⅓ i remi postane favorit.
      </p>

      <h2>4. Dixon-Coles korekcija postoji baš zbog remija</h2>
      <p>
        Čisti Poisson podcjenjuje 0:0 i 1:1. Dixon &amp; Coles (1997) dodaju faktor τ koji diže te niske
        ćelije. Mjerljivo radi: u našoj bazi prosječni p_draw je <b>0.280</b> (DC) vs. <b>0.255</b>{' '}
        (nezavisni-Poisson baseline). Ali pomiče jednu ćeliju, ne cijelu geometriju — remi i dalje nije vrh.
      </p>

      <h2>5. Pouka: argmax ≠ kalibracija</h2>
      <p>
        „Model nikad ne pogađa remi” zvuči kao mana dok ne razdvojiš dvije stvari. <b>Argmax</b> (biramo jedan
        ishod) strukturno je slijep za remi — baš kao kladionice. <b>Kalibracija</b> (vrijedi li vjerojatnost)
        je pravi test: ako model 100 utakmica proglasi remijem s ~25% svaka, treba ih pasti ~25.
      </p>
      <p>
        Pravi remi-postotak u grupnoj fazi SP-a povijesno je ~25–30%. Naš model u <b>zbroju</b> očekuje upravo
        toliko — samo nikad koncentrirano u jednoj utakmici. Prva četiri rezultata to već nagovještavaju: DC je
        očekivao 0.95 remija, pao je točno 1.
      </p>
      <Mermaid chart={PIE('hr')} caption="Canada–BiH: i u najvjerojatnijem ‘1’, remi nosi realan udio." />
      <p>
        Zato projekt mjeri Brier i log-loss, ne „je li remi ikad bio favorit”. Reliability dijagram —
        predviđeno vs. stvarno po košarama vjerojatnosti — kreće na <a href="/accuracy">/accuracy</a> čim
        skupimo 20+ odigranih utakmica.
      </p>

      <hr />
      <p className="muted small">
        Sva matematika je u repozitoriju: <code>fetcher/src/model.ts</code> (tau, dcScoreMatrix, outcomeProbs,
        fitDixonColes). Matrice gore računaju se uživo iz λ, μ, ρ istom formulom kao predikcije.
      </p>
    </div>
  );
}

function En() {
  return (
    <div className="prose">
      <p className="lead">
        Look at every prediction for every match and you notice: <b>not one favours a draw</b> as the most
        likely outcome. It looks unrealistic. It is not — it is mathematically inevitable. Here is why, derived
        from the model&apos;s own code.
      </p>

      <h2>1. The model doesn&apos;t pick a winner — it builds a distribution</h2>
      <p>
        Dixon-Coles never predicts a &ldquo;winner&rdquo;. From each team&apos;s attack and defence it computes{' '}
        <b>expected goals</b> — λ for home, μ for away — then assembles a whole <b>scoreline matrix</b>: the
        probability of every result 0-0, 1-0, 2-1… Only at the end does it sum those cells into three numbers:
        1, X, 2.
      </p>
      <Mermaid chart={PIPELINE('en')} caption="The compute chain: strengths → λ, μ → matrix → outcome (model.ts)." />

      <h2>2. A draw is one thin line; wins are two full halves</h2>
      <p>
        The outcome is just the matrix summed by region. Home win = the <b>entire triangle below</b> the
        diagonal. Away win = the <b>entire triangle above</b>. And a draw? Only the <b>diagonal</b> — 0-0, 1-1,
        2-2… One line of cells against two full halves.
      </p>
      <p>
        Colour below is the outcome region, intensity is the scoreline probability. This is a real match —
        Canada 1-1 BiH, where the model computed λ=2.10, μ=1.03:
      </p>
      <ScoreMatrix lambda={2.1} mu={1.03} homeLabel="1 Canada" awayLabel="2 BiH" />
      <p className="muted small">
        The diagonal (outlined) gathers only 20.6% of the mass; the home triangle 61.8%. The model said
        &ldquo;1&rdquo;, it ended &ldquo;X&rdquo; — but a draw was never impossible, it held one share in five.
      </p>

      <h2>3. Even perfectly even teams lose the draw</h2>
      <p>
        The intuitive thought: if teams are equal (λ = μ), the draw must be the favourite. It is not. The mass
        spreads across <i>both</i> symmetric halves, and the diagonal only keeps what &ldquo;hits&rdquo; the
        same number on both sides. At our model&apos;s league average (1.35 goals per team) a perfectly even
        match gives:
      </p>
      <ScoreMatrix lambda={1.35} mu={1.35} homeLabel="1" awayLabel="2" />
      <p className="muted small">
        0.369 / 0.261 / 0.369 — the draw loses to <i>both</i> sides at once. Only when both expected-goal rates
        fall below ~0.9 (very low-scoring games) does the diagonal cross ⅓ and the draw lead.
      </p>

      <h2>4. The Dixon-Coles correction exists precisely for draws</h2>
      <p>
        Plain Poisson under-counts 0-0 and 1-1. Dixon &amp; Coles (1997) add a τ factor that lifts those low
        cells. It measurably works: in our database the average p_draw is <b>0.280</b> (DC) vs. <b>0.255</b>{' '}
        (independent-Poisson baseline). But it moves one cell, not the whole geometry — the draw still isn&apos;t
        the peak.
      </p>

      <h2>5. The lesson: argmax ≠ calibration</h2>
      <p>
        &ldquo;The model never predicts a draw&rdquo; sounds like a flaw until you separate two things.{' '}
        <b>Argmax</b> (pick one outcome) is structurally blind to draws — just like bookmakers.{' '}
        <b>Calibration</b> (does the probability hold) is the real test: if the model calls 100 matches a draw
        at ~25% each, about 25 should land.
      </p>
      <p>
        The real group-stage draw rate at a World Cup is historically ~25–30%. Our model expects exactly that{' '}
        <b>in aggregate</b> — just never concentrated in one match. The first four results already hint at it:
        DC expected 0.95 draws, exactly 1 landed.
      </p>
      <Mermaid chart={PIE('en')} caption="Canada–BiH: even inside the most-likely ‘1’, the draw carries a real share." />
      <p>
        That is why the project measures Brier and log-loss, not &ldquo;was a draw ever the favourite&rdquo;.
        The reliability diagram — predicted vs. actual per probability bucket — opens on{' '}
        <a href="/accuracy">/accuracy</a> once we have 20+ finished matches.
      </p>

      <hr />
      <p className="muted small">
        All the maths lives in the repo: <code>fetcher/src/model.ts</code> (tau, dcScoreMatrix, outcomeProbs,
        fitDixonColes). The matrices above are computed live from λ, μ, ρ with the same formula as the
        predictions.
      </p>
    </div>
  );
}
