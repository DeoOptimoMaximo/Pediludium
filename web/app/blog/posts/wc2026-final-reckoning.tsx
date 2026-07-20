import type { Lang } from '@/lib/i18n';
import type { ReliabilityBin } from '@/lib/types';
import { Mermaid } from '../../components/Mermaid';
import { ReliabilityChart } from '../../components/ReliabilityChart';
import { ScoreMatrix } from '../../components/ScoreMatrix';

/**
 * Post: "How the models did at WC2026" — the tournament post-mortem (docs/20 track A4,
 * commissioned by docs/21 §3C). The closing companion to `draw-paradox.tsx`, which ended by
 * promising a reliability diagram "once we have 20+ matches". We have 104.
 *
 * Every number here is copied from the published `report` KV key (fetcher/src/calib-report.ts)
 * as of the final export — the same figures /accuracy renders. They are hardcoded rather than
 * fetched because a blog post is a dated argument: it should say what was true when written,
 * even after a recalibrated model (docs/21 §6) changes the live page.
 */

/** Dixon-Coles reliability bins, verbatim from the final report. */
const DC_BINS: ReliabilityBin[] = [
  { lo: 0, hi: 0.2, n: 4, predicted: 0.1806, observed: 0 },
  { lo: 0.2, hi: 0.4, n: 239, predicted: 0.2978, observed: 0.2427 },
  { lo: 0.4, hi: 0.6, n: 66, predicted: 0.4582, observed: 0.6667 },
  { lo: 0.6, hi: 0.8, n: 3, predicted: 0.6224, observed: 0.6667 },
];

/** The Elo+Poisson baseline, which was willing to be far more extreme — and was rewarded. */
const BASE_BINS: ReliabilityBin[] = [
  { lo: 0, hi: 0.2, n: 27, predicted: 0.1742, observed: 0.0741 },
  { lo: 0.2, hi: 0.4, n: 193, predicted: 0.2855, observed: 0.2435 },
  { lo: 0.4, hi: 0.6, n: 77, predicted: 0.4507, observed: 0.5844 },
  { lo: 0.6, hi: 0.8, n: 15, predicted: 0.6325, observed: 0.6667 },
];

const SCORES = (l: Lang) =>
  l === 'hr'
    ? `flowchart LR
  N["nasumično pogađanje<br/>0.667"] --> B
  subgraph B["Brier na istih 97 utakmica — niže je bolje"]
    direction TB
    E["Elo + Poisson<br/><b>0.5705</b>"]
    M["DC × tržište<br/>0.5726"]
    D["Dixon-Coles<br/>0.5799"]
  end`
    : `flowchart LR
  N["random guessing<br/>0.667"] --> B
  subgraph B["Brier on the same 97 matches — lower is better"]
    direction TB
    E["Elo + Poisson<br/><b>0.5705</b>"]
    M["DC × market<br/>0.5726"]
    D["Dixon-Coles<br/>0.5799"]
  end`;

export function Wc2026FinalReckoning({ lang }: { lang: Lang }) {
  return lang === 'hr' ? <Hr /> : <En />;
}

function Hr() {
  return (
    <div className="prose">
      <p className="lead">
        Španjolska je prvak, 104 od 104 utakmice su odigrane, a svaka predikcija koju smo objavili
        zamrznuta je prije početka i sada ocijenjena. Vrijeme je za jedini post koji se ne može
        napisati unaprijed: <b>koliko su modeli zapravo znali</b>. Kratak odgovor — nešto malo, i
        onaj jednostavniji je znao više.
      </p>

      <h2>1. Je li itko išta znao?</h2>
      <p>
        Prvo pitanje nije „koji je model najbolji”, nego „je li ijedan bolji od bacanja kocke”.
        Mjera je <b>Brier</b>: zbroj kvadrata razlika između predikcije i stvarnog ishoda, gdje 0
        znači savršeno, a nasumično pogađanje (⅓-⅓-⅓) daje <b>0.667</b>.
      </p>
      <p>
        Sva tri naša modela su ispod te crte. Dixon-Coles 0.5836, Elo+Poisson 0.5763, blend s
        tržištem 0.5726 — što u „vještini” (koliko si bolji od pogađanja, 0 = nimalo, 1 = savršeno)
        znači <b>0.12 do 0.14</b>. Dakle: da, model zna nešto. I ne, ne zna puno. Nogomet na
        Svjetskom prvenstvu je izrazito nepredvidiv sport, a bilo koji broj bitno veći od ovoga na
        104 utakmice bio bi razlog za sumnju u mjerenje, a ne za slavlje.
      </p>

      <h2>2. Neugodan nalaz: jednostavniji model je pobijedio</h2>
      <p>
        Gornje brojke imaju kvaku. Dixon-Coles i Elo+Poisson ocijenjeni su na svih 104 utakmice, ali
        blend s tržištem uveden je usred turnira pa ih ima 97. Uspoređivati prosjeke preko različitih
        skupova nije usporedba. Zato ih sve ponovno ocjenjujemo na <b>istih 97 utakmica</b> koje su
        svi predviđali:
      </p>
      <Mermaid chart={SCORES('hr')} caption="Jedini poredak koji nešto znači — svi na istom skupu." />
      <p>
        <b>Elo + Poisson, najjednostavniji model u projektu, pobijedio je Dixon-Colesa.</b> Elo je
        jedan broj po momčadi ažuriran nakon svake utakmice; Dixon-Coles je weighted MLE s napadom i
        obranom po momčadi, faktorom domaćeg terena, korekcijom niskih rezultata i eksponencijalnim
        vremenskim ponderiranjem. Složeniji model, lošiji rezultat.
      </p>
      <p>
        Iskušenje je to progutati kao šum — i pošteno je reći da razlika od 0.009 Briera na 97
        utakmica <i>jest</i> unutar šuma. Ali smjer nije slučajan, i kalibracijski dijagram točno
        pokazuje zašto.
      </p>

      <h2>3. Znači li 30% zaista 30%?</h2>
      <p>
        Ovo je pravi ispit vjerojatnosnog modela, i onaj koji smo obećali na kraju{' '}
        <a href="/blog/zasto-nijedna-predikcija-nije-remi">prvog posta</a> — „čim skupimo 20+
        utakmica”. Sad ih ima 104.
      </p>
      <p>
        Svaka predikcija daje tri vjerojatnosti (1, X, 2). Grupiramo ih po visini i pitamo koliko su
        se često zaista ostvarile. Savršeno kalibriran model leži na isprekidanoj dijagonali. Iznad
        nje je bio prestrašljiv, ispod presamouvjeren.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <ReliabilityChart bins={DC_BINS} label="Dixon-Coles" axisPredicted="predviđeno" axisObserved="stvarno" />
        <ReliabilityChart bins={BASE_BINS} label="Elo + Poisson" axisPredicted="predviđeno" axisObserved="stvarno" />
      </div>
      <p>
        Obje krivulje imaju isti oblik — <b>obje su prestrašljive u sredini</b>. Kad je Dixon-Coles
        rekao „otprilike 46%”, dogodilo se to u <b>67%</b> slučajeva. Model je bio u pravu češće nego
        što je sam sebi vjerovao.
      </p>
      <p>
        Ali pogledajte veličinu točaka, jer u njima je cijela priča. Dixon-Coles je{' '}
        <b>239 od 312</b> svojih vjerojatnosti smjestio u pojas 20–40%, a samo <b>4</b> ispod 20% i{' '}
        <b>3</b> iznad 60%. Nijednu iznad 80%. Elo je u isti taj rub stavio <b>27</b> ispod 20% i{' '}
        <b>15</b> iznad 60%. Drugim riječima: Dixon-Coles je sve gurao prema sredini. Kad je 40%
        utakmica objektivno bilo predvidivije od toga, oprez postaje trošak — i to je razlika koja se
        vidi u konačnom Brieru.
      </p>

      <h2>4. Paradoks neriješenog, uzvraćeni udarac</h2>
      <p>
        Prvi post na ovom blogu tvrdio je da nijedna predikcija nikad ne stavlja remi kao
        najvjerojatniji ishod — dijagonala matrice rezultata je jedna tanka linija protiv dvije pune
        polovice. Kao ilustraciju smo uzeli <b>Kanada–BiH</b>, gdje je model računao λ=2.10, μ=1.03 i
        dao 61.8 / 20.6 / 17.6.
      </p>
      <ScoreMatrix lambda={2.1} mu={1.03} homeLabel="1 Canada" awayLabel="2 BiH" />
      <p>
        Ta utakmica je završila <b>1:1</b>. I ne samo to — od svih 104 utakmice turnira, upravo je ona
        ispala <b>najveći promašaj Dixon-Colesa</b>: stvarnom ishodu dao je 20.6%, najmanje od svih.
        Utakmica odabrana kao školski primjer geometrije modela postala je i njegov najskuplji račun.
      </p>
      <p>
        To nije ironija, nego potvrda teze. Tri od pet najvećih iznenađenja Dixon-Colesa bili su{' '}
        <b>remiji</b> (Kanada–BiH 1:1, Japan–Švedska 1:1, Španjolska–Zelenortska Republika 0:0). Remi
        je strukturno nemoguć kao argmax, ali se svejedno događa u svakoj četvrtoj do petoj utakmici.
        Model koji to ne može „pogoditi” nije pokvaren — samo ga se ne smije ocjenjivati po argmaxu.
        Zato ova stranica postoji.
      </p>

      <h2>5. Grupe protiv knockouta</h2>
      <p>
        Očekivali bismo da je knockout teži: nema slabih parova, sve je izjednačeno. Za Elo+Poisson
        to i vrijedi — 0.565 u grupama, <b>0.602</b> u knockoutu, osjetno lošije. Ali Dixon-Coles je
        išao u <i>suprotnom</i> smjeru: 0.588 u grupama, <b>0.573</b> u knockoutu.
      </p>
      <p>
        Objašnjenje je vjerojatno isto ono iz treće točke. Grupna faza puna je asimetričnih parova
        gdje se isplati biti odlučan, a upravo tamo je Dixon-Colesov oprez najskuplji. U knockoutu,
        gdje su momčadi stvarno izjednačene, „sve prema sredini” slučajno je ispravna politika. Model
        nije bio bolji u knockoutu — samo je knockout više nalikovao onome što on ionako uvijek radi.
      </p>

      <h2>6. Protiv kladionice — uz veliku ogradu</h2>
      <p>
        Kvote smo ocijenili potpuno isto kao model: zamrznute prije početka, preračunate u
        vjerojatnosti. Na 11 utakmica gdje imamo i jedno i drugo, tržište daje Brier 0.549, naš blend
        s tržištem 0.534, Elo 0.575, Dixon-Coles 0.598.
      </p>
      <p className="muted small">
        Ovo je premali uzorak da bilo što dokaže. Dohvat kvota otpao nam je rano u turniru, pa imamo
        12 utakmica, sve iz grupne faze. Navodimo brojku jer je poštenije objaviti mršav uzorak s
        oznakom „mršav” nego ga prešutjeti — ali nemojte iz nje zaključiti da smo pobijedili
        kladionicu.
      </p>

      <h2>7. Što je s ovim brojkama bilo pokvareno</h2>
      <p>
        Post koji tvrdi da mjeri poštenje mora prvo priznati vlastite rupe. Tri su:
      </p>
      <p>
        <b>Simulacijska povijest bila je djelomično nekondicionirana.</b> Izgledi za naslov kroz
        turnir računali su se tako da su se slotovi knockouta vezali uz sirova imena momčadi, koja su
        ostajala ustajala dok je naš dohvat podataka bio u kvaru, a već odigrane knockout utakmice
        simulirale su se iznova. Posljedica: serije „tko će biti prvak” iz sredine turnira mjestimično
        ne odgovaraju onome što se do tada već znalo. Popravljeno je tek 20. srpnja, <i>nakon</i>{' '}
        finala. Predikcije po utakmici — sve brojke u ovom postu — time nisu zahvaćene, jer se
        zamrzavaju prije početka i nikad se ne prepisuju. Ali kad na{' '}
        <a href="/simulation">/simulation</a> gledate kako se mišljenje mijenjalo kroz lipanj, znajte
        da tu krivulju treba čitati s rezervom.
      </p>
      <p>
        <b>Baza je kroz turnir imala 18 tihih ispada</b>, najdulji oko šest dana. Neke utakmice zato
        nisu dobile predikciju u zadnjem satu prije početka pa im je ocijenjena zadnja ranija
        zamrznuta — bezopasno za metodu, ali znači da „zamrznuto prije početka” ponegdje znači nekoliko
        sati ranije, a ne nekoliko minuta.
      </p>
      <p>
        <b>Uzorak je 104 utakmice.</b> Razlike od nekoliko tisućinki Briera nisu statistički značajne.
        Poredak modela iz druge točke je smjer, ne presuda.
      </p>

      <h2>8. Što slijedi</h2>
      <p>
        Kalibracijski dijagram nije samo ocjena, nego i uputa za popravak. Sustavno odstupanje od
        dijagonale — predviđeno 46%, stvarno 67% — upravo je ono što <b>izotonička kalibracija</b>
        zna ispraviti: naknadna monotona transformacija koja vjerojatnosti razvuče natrag prema
        rubovima. To je sljedeći korak, i doći će kao <i>novi</i> model uz postojeće, pod novom
        verzijom, jer se stare predikcije u ovom projektu nikad ne prepisuju. Bit će zanimljivo
        vidjeti pobijedi li kalibrirani Dixon-Coles konačno Elo.
      </p>
      <p>
        Do tada, svi brojevi iz ovog posta žive na <a href="/accuracy">/accuracy</a>, utakmicu po
        utakmicu, s izračunom koji možete provjeriti.
      </p>

      <hr />
      <p className="muted small">
        Agregacija je u <code>fetcher/src/calib-report.ts</code> (čista funkcija, 20 testova),
        ocjenjivanje u <code>fetcher/src/export-snapshot.ts</code>. Brier i log-loss računaju se iz
        tablice <code>prediction_history</code>, uzimajući zadnji zapis prije početka utakmice.
      </p>
    </div>
  );
}

function En() {
  return (
    <div className="prose">
      <p className="lead">
        Spain are champions, all 104 matches have been played, and every prediction we published was
        frozen before kick-off and has now been scored. Time for the one post that cannot be written
        in advance: <b>how much did the models actually know?</b> Short answer — a little, and the
        simpler one knew more.
      </p>

      <h2>1. Did anyone know anything?</h2>
      <p>
        The first question is not “which model is best” but “is any of them better than a dice roll”.
        The measure is the <b>Brier score</b>: the sum of squared differences between prediction and
        outcome, where 0 is perfect and random guessing (⅓-⅓-⅓) scores <b>0.667</b>.
      </p>
      <p>
        All three of our models are below that line. Dixon-Coles 0.5836, Elo+Poisson 0.5763, the
        market blend 0.5726 — which in “skill” terms (how much better than guessing; 0 = not at all,
        1 = perfect) means <b>0.12 to 0.14</b>. So: yes, the models know something. And no, not much.
        World Cup football is a strikingly unpredictable sport, and any number much larger than this
        over 104 matches would be a reason to doubt the measurement rather than to celebrate.
      </p>

      <h2>2. The uncomfortable finding: the simpler model won</h2>
      <p>
        Those numbers come with a catch. Dixon-Coles and Elo+Poisson were scored on all 104 matches,
        but the market blend was introduced mid-tournament, so it has 97. Comparing averages across
        different sets is not a comparison. So here they all are, re-scored on the{' '}
        <b>same 97 matches</b> every one of them predicted:
      </p>
      <Mermaid chart={SCORES('en')} caption="The only ranking that means anything — all on one set." />
      <p>
        <b>Elo + Poisson, the simplest model in the project, beat Dixon-Coles.</b> Elo is one number
        per team updated after each match; Dixon-Coles is a weighted MLE with per-team attack and
        defence, a home-advantage term, a low-score correction and exponential time-decay weighting.
        The more sophisticated model did worse.
      </p>
      <p>
        It is tempting to write this off as noise — and in fairness, a 0.009 Brier gap over 97
        matches <i>is</i> within noise. But the direction is not random, and the reliability diagram
        shows exactly why.
      </p>

      <h2>3. Does 30% really mean 30%?</h2>
      <p>
        This is the real exam for a probabilistic model, and the one we promised at the end of the{' '}
        <a href="/blog/zasto-nijedna-predikcija-nije-remi">first post</a> — “once we have 20+
        matches”. We now have 104.
      </p>
      <p>
        Every prediction gives three probabilities (1, X, 2). We bucket them by size and ask how often
        they actually happened. A perfectly calibrated model sits on the dashed diagonal. Above it,
        the model was too timid; below it, too confident.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <ReliabilityChart bins={DC_BINS} label="Dixon-Coles" axisPredicted="predicted" axisObserved="observed" />
        <ReliabilityChart bins={BASE_BINS} label="Elo + Poisson" axisPredicted="predicted" axisObserved="observed" />
      </div>
      <p>
        Both curves have the same shape — <b>both are too timid in the middle</b>. When Dixon-Coles
        said “about 46%”, it happened <b>67%</b> of the time. The model was right more often than it
        believed itself.
      </p>
      <p>
        But look at the dot sizes, because that is the whole story. Dixon-Coles put{' '}
        <b>239 of its 312</b> probabilities in the 20–40% band, and only <b>4</b> below 20% and{' '}
        <b>3</b> above 60%. None above 80%. Elo put <b>27</b> below 20% and <b>15</b> above 60%. In
        other words: Dixon-Coles squeezed everything toward the middle. When 40% of matches were
        objectively more predictable than that, caution becomes a cost — and that is the gap you see
        in the final Brier.
      </p>

      <h2>4. The draw paradox strikes back</h2>
      <p>
        The first post on this blog argued that no prediction ever makes a draw the most likely
        outcome — the diagonal of the scoreline matrix is one thin line against two full halves. As
        the illustration we used <b>Canada–BiH</b>, where the model computed λ=2.10, μ=1.03 and
        produced 61.8 / 20.6 / 17.6.
      </p>
      <ScoreMatrix lambda={2.1} mu={1.03} homeLabel="1 Canada" awayLabel="2 BiH" />
      <p>
        That match finished <b>1:1</b>. And not only that — of all 104 matches in the tournament, it
        turned out to be <b>Dixon-Coles's single biggest miss</b>: it gave the actual outcome 20.6%,
        the lowest of any match. The fixture picked as a textbook example of the model's geometry
        became its most expensive bill.
      </p>
      <p>
        That is not irony, it is confirmation. Three of Dixon-Coles's five biggest surprises were{' '}
        <b>draws</b> (Canada–BiH 1:1, Japan–Sweden 1:1, Spain–Cabo Verde 0:0). A draw is structurally
        impossible as an argmax, yet happens in roughly every fourth or fifth match. A model that
        cannot “call” one is not broken — it just must not be judged by its argmax. Which is why this
        page exists.
      </p>

      <h2>5. Groups versus knockout</h2>
      <p>
        You would expect the knockout to be harder: no weak pairings, everything tight. For
        Elo+Poisson that holds — 0.565 in the groups, <b>0.602</b> in the knockout, clearly worse.
        But Dixon-Coles went the <i>other</i> way: 0.588 in the groups, <b>0.573</b> in the knockout.
      </p>
      <p>
        The explanation is probably the same as in section 3. The group stage is full of asymmetric
        pairings where being decisive pays, and that is exactly where Dixon-Coles's caution costs the
        most. In the knockout, where teams really are evenly matched, “everything toward the middle”
        happens to be the correct policy. The model was not better in the knockout — the knockout
        simply looked more like what it always does anyway.
      </p>

      <h2>6. Against the bookmaker — with a large caveat</h2>
      <p>
        We scored the odds exactly like a model: frozen before kick-off, converted to probabilities.
        On the 11 matches where we have both, the market scores 0.549, our market blend 0.534, Elo
        0.575, Dixon-Coles 0.598.
      </p>
      <p className="muted small">
        This sample is far too small to prove anything. Our odds feed dropped out early in the
        tournament, so we have 12 matches, all from the group stage. We publish the number because it
        is more honest to show a thin sample labelled “thin” than to omit it — but please do not
        conclude from it that we beat the bookmaker.
      </p>

      <h2>7. What was broken about these numbers</h2>
      <p>A post claiming to measure honesty has to admit its own holes first. There are three:</p>
      <p>
        <b>The simulation history was partially unconditioned.</b> Title odds through the tournament
        were computed by pinning knockout slots to raw team names, which went stale while our data
        feed was broken, and knockout matches already played were re-simulated. The consequence:
        mid-tournament “who will win it” series do not always reflect what was already known at the
        time. It was only fixed on 20 July, <i>after</i> the final. The per-match predictions — every
        number in this post — are unaffected, because those are frozen before kick-off and never
        overwritten. But when you look at <a href="/simulation">/simulation</a> to see how opinion
        shifted through June, read that curve with caution.
      </p>
      <p>
        <b>The database suffered 18 silent outages</b> during the tournament, the longest about six
        days. Some matches therefore got no prediction in the final hour before kick-off, so the last
        earlier frozen one was scored — harmless to the method, but it means “frozen before kick-off”
        sometimes means a few hours earlier rather than a few minutes.
      </p>
      <p>
        <b>The sample is 104 matches.</b> Brier differences of a few thousandths are not
        statistically significant. The ranking in section 2 is a direction, not a verdict.
      </p>

      <h2>8. What comes next</h2>
      <p>
        The reliability diagram is not just a grade, it is a repair manual. A systematic departure
        from the diagonal — predicted 46%, observed 67% — is precisely what{' '}
        <b>isotonic calibration</b> fixes: a monotone post-hoc transformation that stretches
        probabilities back toward the edges. That is the next step, and it will arrive as a{' '}
        <i>new</i> model alongside the existing ones, under a new version, because predictions in
        this project are never overwritten. It will be interesting to see whether a calibrated
        Dixon-Coles finally beats Elo.
      </p>
      <p>
        Until then, every number in this post lives on <a href="/accuracy">/accuracy</a>, match by
        match, with arithmetic you can check.
      </p>

      <hr />
      <p className="muted small">
        The aggregation is in <code>fetcher/src/calib-report.ts</code> (a pure function, 20 tests),
        the scoring in <code>fetcher/src/export-snapshot.ts</code>. Brier and log-loss are computed
        from the <code>prediction_history</code> table, taking the last row before kick-off.
      </p>
    </div>
  );
}
