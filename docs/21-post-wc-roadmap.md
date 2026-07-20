# 21 — Post-WC2026: dijagnoza, dugoročno upravljanje i promptovi za dorade

> Napisano 2026-07-20 (dan nakon finala WC2026), analiza: Claude Fable 5.
> Namjena: **runbook + backlog s gotovim promptovima** koje izvršava Opus 4.8 (ili bilo koji
> agent) — svaki prompt je samostalan, s kontekstom, kriterijima prihvaćanja i zamkama.
> Redoslijed sekcija = preporučeni redoslijed izvođenja.

---

## 0. Stanje na dan pisanja (dijagnoza — zašto je /scorecard stao)

**Simptom:** nogomet.domovina.ai/scorecard danima nije osvježen; finale odigrano, a site
zadnji rezultat ima od 9. srpnja (QF Francuska–Maroko 2:0).

**Dijagnoza (potvrđeno iz logova i baze):**

1. **Postgres (Supabase Docker, port 56322) bio je ugašen ~9.–18. srpnja.**
   `~/Library/Logs/pediludium/matchsync.log` sadrži **576 uzastopnih tickova** s
   `[sync-gate] fatal: connect ECONNREFUSED 127.0.0.1:56322`. Docker kontejneri sada kažu
   „Up 2 days" — baza se vratila tek 18.7. Launchd jobovi su cijelo vrijeme *radili*
   (exit 0!), ali je gate grešku tretirao kao „skip" (fail-safe za Firecrawl kredite) —
   pa je ispalo **tiho** zatajenje: nijedan alarm, nijedan ne-nula exit.
2. **Nema catch-up mehanizma.** `should-sync.ts` prozor je `[now-18h, now+15m]` računat od
   **zidnog sata**, ne od zadnjeg uspješnog synca. Kad se baza vratila 18.7., utakmice
   odigrane 10.–15.7. bile su davno izvan prozora → nikad ponovno provjerene.
3. **Kaskadni knockout fail.** Bez QF rezultata `resolve:ko` nije mogao razriješiti
   SF/finale slotove → finale je u bazi ostalo `W101 v W102` (placeholder), pa je i tick
   koji ga je 19.7. uhvatio u prozoru scrapeao krivi/prazan slug i preskočio
   (`--- notstarted → skip`).
4. **Mobilni proxy (iPhone) i dalje mrtav** — hourly `refresh --full` pada svaki sat s
   `ERR_PROXY_CONNECTION_FAILED`, pa ni taj put nije mogao nadoknaditi podatke. (Poznato
   otprije; Firecrawl fallback je i uveden zbog toga — ali fallback nema catch-up, v. 2.)
5. Ranije manje rupe: matchsync log nema ni 5.–6.7. i 8.7. → zato nedostaju i **dva
   osmine finala** (Norveška–Brazil 5.7., Engleska–Meksiko 6.7.) iako su QF slotovi
   djelomično razriješeni preko Firecrawl bracket scrapea.

**Stanje baze (season 58210):** 95/104 utakmica finished; **9 nedostaje**: 2× R16
(12813006 Norveška–Brazil, 12813007 Engleska–Meksiko), 3× QF (12812994
Španjolska–Belgija, 12813017 Norveška–Engleska, 12813015 Švicarska–Argentina), 2× SF
(12813008 `W97 v W98`, 12812996 `W99 v W100`), 3. mjesto (12813003 `L101 v L102`),
finale (12813005 `W101 v W102`).

Firecrawl krediti: aktivni ključ ima ~820 kredita, rotate.sh radi. KV write gate radi
(0 upisa u mirovanju). Infra je dakle zdrava — nedostaje samo nadoknada podataka i
otpornost da se ovo ne ponovi.

---

## 1. PROMPT — Hitni catch-up: upiši svih 9 utakmica i objavi finalni snapshot

> **Prioritet: ODMAH.** Sve ostalo može čekati; site s neodigranim finalom je mrtav site.

```text
Radiš u /Users/ms/git/DeoOptimoMaximo/Pediludium (pročitaj ARCHITECTURE.md i
docs/21-post-wc-roadmap.md §0 za kontekst incidenta). U Postgresu (port 56322, sada radi)
nedostaje 9 zadnjih utakmica WC2026 (season 58210) — popis ss_id-ova u docs/21 §0.
Mobilni proxy NE radi; koristi isključivo Firecrawl put (refresh:fc + resolve:ko), kao
što to radi scripts/match-sync.sh.

Zadatak — iterativna nadoknada iz fetcher/ direktorija:
1. bash ~/.config/firecrawl/rotate.sh (osiguraj ključ s kreditima).
2. env REFRESH_FC_SINCE_H=400 npm run refresh:fc
   — široki prozor od ~400h pokriva sve od 5.7.; utakmice s pravim imenima (2×R16, 3×QF)
   trebale bi dobiti rezultate. Provjeri u bazi da su status_type='finished' i da skorovi
   odgovaraju stvarnima.
3. env RESOLVE_KO_SEEDS=1 npm run resolve:ko — razriješi SF slotove iz QF pobjednika.
   ⚠ KRUCIJALNA ZAMKA (memorija „knockout obrnuti pobjednik", fix u commitu 2040007):
   slug redoslijed ≠ home/away; nakon resolve-a OBAVEZNO provjeri da parovi i kasnije
   pobjednici nisu obrnuti.
4. Ponavljaj korake 2–3 dok finale i utakmica za 3. mjesto nemaju prave timove i
   rezultate (očekuj 2–3 prolaza: QF→SF→finale). Ako refresh:fc za neku utakmicu vrti
   „notstarted → skip", provjeri slug u match.raw — resolve:ko treba osvježiti
   raw.slug/customId; po potrebi ručno ispravi slug u bazi pa ponovi.
5. Kad je svih 104/104 finished: npm run standings && npm run predict:dc &&
   npm run predict:dcm && npm run simulate && npm run history:record && npm run snapshot
   (redoslijed iz scripts/match-sync.sh; snapshot = export + diff-publish u KV/R2).
6. Verifikacija: na https://nogomet.domovina.ai provjeri /scorecard (svi rezultati),
   /bracket (kompletan knockout s pravim pobjednikom), /accuracy (104 ocijenjene
   utakmice). Pazi na lock /tmp/pediludium-snapshot.lock (dijeli se s launchd jobovima —
   ako postoji, pričekaj tick ili provjeri da nije ostao siroče).

Kriterij prihvaćanja: SELECT count(*) FROM match WHERE season_id=58210 AND
status_type='finished' vraća 104; /bracket prikazuje prvaka; KV upisi ostaju razumni
(diff-upload, jedan publish).
```

---

### ✅ §1 IZVRŠEN 2026-07-20 (ista sesija, Fable 5) — epilog i naučeno

Svih 104/104 utakmica upisano i objavljeno (52 KV ključa + R2 arhiva, digest commitan).
**Španjolska je prvak** (finale Španjolska 1–0 Argentina; 3. mjesto Francuska 4–6
Engleska — stvarni FT, poluvrijeme 0–4!). /scorecard i /bracket verificirani live.
Tri stvari koje su iskočile izvan plana — bitno za §2/§4:

1. **`resolve:ko` NE zna razriješiti polufinala unatrag** — on samo scrapea tournament
   stranicu (koja više ne prikazuje prošla kola) i match stranice po *starom* placeholder
   slugu (404). Ne izvodi pobjednike iz feeder utakmica. Workaround koji je upalio:
   scrape **timske stranice** finalista (`/team/football/spain/4698`) → recent-form
   sadrži linkove `{slug}/{customId}#id:{matchId}` za sve KO utakmice → ručni SQL
   UPDATE slotova + `raw.slug`/`raw.customId` (isti oblik kao resolve:ko update), pa
   `refresh:fc` normalno povuče rezultat. Kandidat za ugradnju u resolve:ko (§2 ili §5).
2. **`simulate` nije kondicionirao na odigrane rezultate** — bracket je pinao iz
   `raw->homeTeam->name` (stale placeholderi otkad je proxy mrtav; resolve:ko ažurira
   samo team id-eve, NE raw imena), a odigrane KO utakmice je ponovno simulirao → nakon
   finala izbacivao „Maroko 13% prvak". **Popravljeno u ovoj sesiji** (`simulate.ts`):
   slotovi se pinaju iz `home/away_team_id` (autoritativno), završene grupne utakmice
   koriste stvarni rezultat umjesto samplinga, završene KO utakmice deterministički
   propagiraju pobjednika (0–0 nakon penala → pobjednik izveden iz pojavljivanja u
   kasnijoj rundi, uz isključenje utakmice za 3. mjesta za SF). Sada: 100% Španjolska.
   ⚠ Posljedica za §3A: simulation_history serije SU kroz turnir bile djelomično
   nekondicionirane (pin je radio samo dok su raw imena bila svježa) — u završnom
   izvještaju to pošteno napomenuti.
3. **Sync-gate sada trajno SKIP-a** (sve utakmice finished) → 0 Firecrawl kredita — ali
   hourly job i dalje svaki sat pali mrtvi proxy refresh (bezopasno, gate publish
   preskače). §3B to formalizira.

---

## 2. PROMPT — Operativna otpornost: da se „tihih 9 dana" više ne dogodi

**Analiza problema:** tri neovisna zatajenja (baza down, proxy down, prozor bez
catch-upa) i **nijedno nije nigdje alarmiralo**. Launchd jobovi vraćaju exit 0 čak i kad
svaki korak padne („stale-but-consistent" filozofija je dobra za publish, ali loša za
observability). Sve gate skripte grešku baze tretiraju kao skip.

```text
Radiš u /Users/ms/git/DeoOptimoMaximo/Pediludium (kontekst: docs/21 §0 i §2 — incident
9.–18.7.2026). Cilj: sustav koji se sam javi kad je bolestan i sam se nadoknadi kad
ozdravi. Napravi sljedeće, minimalno invazivno, u duhu postojećih skripti:

A) HEALTH/ALERTING — novi src/health.ts + launchd job (svakih 30 min):
   - provjeri: (1) Postgres dostupan, (2) starost zadnjeg uspješnog refresh-a (nova
     meta tablica ili max(fetched_at) iz match), (3) ima li utakmica koje su prošle
     start_ts + 3h a nisu finished („stranded"), (4) doseg mobilnog proxyja (best-effort),
     (5) starost zadnjeg KV publisha (digest iz should-publish.ts).
   - ako je nešto crveno → notifikacija koja NE ovisi o bazi ni o Macu-u koji spava:
     ntfy.sh topic ili e-mail (postoji cloudflare-email-service skill; najjednostavnije
     curl na ntfy). Alarm šalji s cooldownom (max 1/6h po tipu) da ne spamira.
   - health JSON upiši i u KV (ključ `health`) pa na webu dodaj diskretni banner
     „podaci kasne od <ts>" kad je snapshot stariji od N sati — korisnik zaslužuje znati.

B) CATCH-UP UMJESTO ZIDNOG SATA — should-sync.ts i refresh-firecrawl.ts:
   - prozor temelji na „nedovršene utakmice čiji je start_ts u prošlosti" s gornjom
     granicom starosti (npr. 14 dana) + eskalirajućim backoffom po utakmici (nakon K
     neuspješnih provjera provjeravaj tu utakmicu rjeđe — npr. svakih 6h umjesto 15 min)
     da stranded utakmica ne pali Firecrawl kredite svakih 15 min zauvijek.
   - gate na ECONNREFUSED smije skipati tick (fail-safe je ok), ali NE smije biti nijem:
     upiši u log brojač uzastopnih grešaka i nakon 4 uzastopne pošalji alert iz A).

C) DOCKER/SUPABASE AUTOSTART — utvrdi zašto je Supabase bio down 9 dana (Docker Desktop
   ugašen? reboot?) i osiguraj autostart (Docker Desktop „start at login" ili launchd
   KeepAlive za `supabase start`/colima). Dodaj u health check iz A) eksplicitnu poruku
   „Supabase down — pokreni X".

D) LOG HIGIJENA — svaki tick (i skip!) loga JEDAN timestampirani redak s ishodom
   (sync-gate SKIP linije danas nemaju datum pa je forenzika bila mukotrpna); logrotate
   za ~/Library/Logs/pediludium/ (logovi su već >2 MB).

Kriterij prihvaćanja: simuliraj kvar (privremeno zaustavi Supabase kontejnere) →
u 30 min stiže notifikacija; vrati bazu → sljedeći matchsync tick sam pokupi
„stranded" utakmicu bez ručnog širenja prozora. Testovi za novu gate logiku (vitest,
uz postojeće u fetcher/).
```

---

### ✅ §2 IZVRŠEN 2026-07-20 (Opus 4.8, `5c8fb90`+`6b7c4fd` → main `4d49797`) — epilog i naučeno

Sustav sada ima alarm, sam se nadoknađuje i sam se popravlja. Ono što je iskočilo izvan
pretpostavki prompta — bitno za §3/§4:

1. **Ispad nije bio jedan, nego OSAMNAEST.** Rekonstrukcija `matchsync.log` (skripta koja
   nosi zadnji datirani redak naprijed, jer SKIP linije nisu imale datum) pokazuje ispade
   baze od 18.6. do 18.7.: 15.2 h (24.6.), 9.0 h (29.6.), 8.2 h (1.7.), **20.8 h (4.–5.7.)**
   i konačno ~6 dana od 9.7. Onaj od 4.7. je izravno objašnjenje zašto nedostaju **baš dva
   osmine finala** (Norveška–Brazil 5.7., Engleska–Meksiko 6.7.) — docs/21 §0 je to vodio
   kao zasebnu „rupu u logu". Nije bila zasebna: ista bolest, raniji napad.
2. **Uzorak je noćni, ne „netko je ugasio Docker".** Većina epizoda počinje kasno navečer i
   traje 8–20 h uz **launchd tickove koji uredno rade** (exit 0, ECONNREFUSED). To je potpis
   *dark wakea*: Mac se budi taman toliko da launchd opali, Docker VM nije podignut, veza
   odbijena, natrag u san. Uz to je uključen Resource Saver (`UseResourceSaver=true`, 300 s).
3. **„Uključi Docker start at login" NIJE bilo rješenje** — `settings-store.json` na ovom
   stroju ima `AutoStart=False` uz `AutoStartError: "operation is not permitted when
   registering app service"`: macOS odbija registraciju login itema, postavka je mrtva.
   Zato oporavak živi u repou (`scripts/supabase-guard.sh`), a ne u tuđim preferencama.
   Provjereno: kontejner ugašen → guard ga vratio u **5 s**, health opet zelen.
4. **Liveness heartbeat NE smije visjeti o `refresh:fc`.** Prva verzija je tako radila i bila
   bi trajno crvena čim sezona završi (nema što dohvatiti → nema heartbeata → „ingest je
   mrtav"). Sada beat piše `should-sync` na svakom ticku, i na SKIP: jedini signal koji
   ostaje svjež u zdravom, mirnom sustavu. Ista logika i za banner na webu — crven zbog
   arhivirane sezone znači da ga nitko neće gledati.
5. **Alarm koji se sam popravi nije alarm.** `health.ts --defer-db-alert` (prvi prolaz) izlazi
   s kodom 2 umjesto da odmah zove; tek ako guard ne uspije, drugi prolaz šalje poruku.
   Ručni `npm run health` alarmira odmah.

**Regresija (crvena linija):** utakmica odigrana prije 221 h s obrisanim rezultatom — stara
18h logika je vidi **0 puta**, nova je odmah stavlja na red (`PROCEED — Spain v Belgium`,
ironično baš jedan od izgubljenih QF-ova). Nakon vraćanja: digest `wc2026_match` **bit-identičan**
(`c6cb0df6…` prije i poslije), `should-publish` SKIP, 63/63 testa, typecheck čist.

6. **`fetcher/.env` se NIKAD nije učitavao.** Sve skripte se pokreću kao goli `node src/x.ts`,
   pa je `.env` dosad bio čista dokumentacija — kod je živio na defaultima iz `config.ts`.
   Bezopasno dok nije zatrebala prva prava tajna. Skripte kojima treba (`health`, `alert:test`,
   `should-sync`) sad idu s `--env-file-if-exists=.env`; ostale namjerno nisu dirane da im se ne
   podmetnu vrijednosti koje nikad nisu vidjele. **Provjeriti pri svakoj novoj env varijabli.**
7. **Prvi pravi alarm nije prošao** — `Title` HTTP zaglavlje je ByteString, pa su hrvatski
   dijakritici i emoji (`Pediludium 🔴`) bacali iznimku *unutar* `fetch`a, prije slanja. Sad se
   ne-ASCII naslovi šalju kao RFC 2047 encoded-word (ntfy to dekodira), uz round-trip test.
   Pouka: alarm koji nikad nije stvarno poslan ne postoji — testirati isporuku, ne samo logiku.

**Zatvoreno:** `HEALTH_NTFY_TOPIC` generiran i upisan u `fetcher/.env` (dijeljena tajna, nikad u
repo); testna i stvarna `db-down` poruka isporučene; mergeano na `main` (`4d49797`, pushano);
web deployan (`ccc423da`) — `/`, `/scorecard`, `/bracket`, `/accuracy` sve 200, banner ispravno
**nije** prikazan jer je sezona arhivirana. Health launchd job (`com.pediludium.health`) instaliran
i vrti se svakih 30 min.

### ✅ §2E DODANO 2026-07-20 — dead-man's switch (rupa koju §2 nije pokrivao)

§2 je riješio „nešto je puklo", ali ne i sloj ispod: **health check radi NA Macu.** Ako je Mac
ugašen, trajno uspavan ili je launchd stao, ništa se ne izvrši, ništa se ne pošalje, a **tišina
izgleda identično zdravlju** — točno oblik kvara koji je i sakrio 18 ispada. Čuvar ne smije
živjeti u sustavu koji čuva.

`watchdog/` = zaseban Cloudflare Worker (`pediludium-watchdog`), cron `0 */3 * * *`, čita KV ključ
`health` koji Mac ionako piše i javi ako prestane biti osvježavan. Dijeli **nula** domene kvara s
onim što nadzire: drugi stroj, druga mreža, drugo napajanje.

Odluke koje nisu očite:
- **Prag je 12 h, ne 1 h.** Mac legitimno spava noću i launchd tada ne okida — uski prag bi zvonio
  svako jutro, a alarm koji svaki dan laže gori je od nikakvog (ista logika po kojoj je provjera
  proxyja `warn`, nikad `red`). 12 h i dalje hvata „stroj se nije vratio" unutar jednog radnog dana.
- **Zaseban worker, ne ruta u `pediludium-web`.** Čuvar koji se deploya zajedno s nadziranim
  može biti srušen istim deployem. Uz to `workers_dev: false` i bez rute → dohvatljiv je isključivo
  vlastitim cronom, pa ga se izvana ne može ni bockati ni natjerati da šalje poruke.
- **Ne sudara se s publish diffom:** `publish-snapshot.ts` briše samo ključeve koje je sam prije
  objavio (`.published-kv.json`); `health` i `watchdog:state` nisu u `kv-bulk.json` pa ostaju.

Provjereno protiv produkcijskog KV-a i prave tajne (`wrangler dev --remote --test-scheduled`):
normalno stanje → tiho; prag 0 h → alarm isporučen; povratak → poruka o oporavku (`priority: low`)
+ cooldown očišćen (`watchdog:state` ostaje samo `lastSeenAt`). 8 testova.

**Preostala rupa (svjesno prihvaćena):** ako padne Cloudflare, nema čuvara nad čuvarom. Sljedeći
sloj bi bio vanjski servis tipa healthchecks.io — nije uzeto jer bi uveo trećeg pružatelja radi
scenarija bitno manje vjerojatnog od „Mac je ugašen".

---

## 3. PROMPT — Arhiviranje WC2026: završni račun turnira

**Analiza:** turnir je gotov — season 58210 prelazi iz „live" u „arhiva". To je i prilika
za ono zbog čega projekt postoji: **provjerljivost**. Imamo 93k redaka prediction_history
i 28k simulation_history — kompletan zapis kako su se mišljenja modela mijenjala kroz
cijeli turnir, za sva tri modela (dixon-coles-v1, dc-market-v1, baseline-poisson-elo-v1).

```text
Radiš u /Users/ms/git/DeoOptimoMaximo/Pediludium (pročitaj ARCHITECTURE.md; preduvjet:
docs/21 §1 izvršen — svih 104 utakmica finished). Zadatak, tri dijela:

A) ZAVRŠNI ACCURACY IZVJEŠTAJ — proširi /accuracy (i calib KV ključ) u završni obračun
   turnira: ukupni Brier/log-loss po modelu i po fazi (grupe vs knockout), usporedba s
   naivnim baselineom (uniformna 1/3) i s tržišnim kvotama gdje postoje (match_odds),
   reliability dijagram (sad imamo 104 utakmice — memorija kaže da se čekalo 20+),
   te top-N „najvećih iznenađenja" (najniža p za ostvareni ishod). Sve iz postojećih
   tablica (prediction_history/prediction + match) — bez novih fetcheva.

B) ZAMRZNI SEZONU — dodaj koncept završene sezone: u match-sync/should-sync gateu
   sezona sa svih X/X finished ne generira više nikakav rad (danas bi gate barem
   vrtio prazne provjere); hourly refresh za nju više nema smisla. NE gasi launchd
   jobove — samo neka postanu no-op za završenu sezonu (bitno za §4: isti jobovi će
   voziti sljedeće natjecanje). Snapshot ostaje objavljen — site je sada arhiva.

C) ZAVRŠNI BLOG POST — po planu serije u docs/20 napiši post „kako su modeli prošli
   na WC2026" koristeći brojke iz A) (postojeće komponente: Mermaid, ScoreMatrix).
   Ton kao docs/17 (paradoks neriješenog): tehnički, pošten prema promašajima.

Kriterij prihvaćanja: /accuracy prikazuje završni obračun; matchsync log nakon deploya
pokazuje 0 Firecrawl poziva; blog post objavljen na /blog.
```

---

### ✅ §3 IZVRŠEN 2026-07-20 (Opus 4.8, `f2d934d`+`264445f`+`a5d0fb3`) — epilog i naučeno

Sva tri dijela isporučena i na produkciji: `/accuracy` nosi završni obračun, oba joba su
čisti no-op, blog post živi na `/blog/kako-su-modeli-prosli-wc2026`. Publish: **4 KV upisa
od 181 ključa** (`report` nov, `calib` dobio `phase`), web deployan (`8e9678b5`).

**1. Model je pao na vlastitom ispitu — i to je glavni nalaz.** Na poštenom skupu (istih 97
utakmica koje su svi predviđali) **Elo+Poisson 0.5705 < dc-market 0.5726 < Dixon-Coles
0.5799**. Najjednostavniji model u projektu nadmašio je onaj u koji je uloženo najviše
matematike. Razlika (0.009) jest unutar šuma na 104 utakmice i tako je i objavljena, ali
smjer objašnjava kalibracija: DC je **239 od 312** vjerojatnosti smjestio u pojas 20–40%,
samo 4 ispod 20%, 3 iznad 60%, **nijednu iznad 80%**; Elo je u rubove stavio 27 odnosno 15.
DC gura sve prema sredini. Kad je rekao „46%", palo je u **67%** slučajeva — bio je u pravu
češće nego što je sam sebi vjerovao. To nije anegdota nego izravan ulaz u §6: izotonička
kalibracija popravlja točno ovaj oblik greške, i sad postoji brojka prema kojoj se mjeri.

**2. Usporedba modela na različitim skupovima je tiha laž, pa je struktura sprječava.**
`dc-market-v1` uveden je usred turnira (97 od 104), a kvota ima za 12 utakmica. Prva verzija
izvještaja imala je jedan `common` presjek preko svih — i on je pao na **n=11**, jer 12
kvota sreže sve. Sad su to dvije odvojene brojke: `common` (samo naši modeli, n=97, jedini
legitiman poredak) i `vsMarket` (n=11, objavljen s izričitom ogradom). Svaki agregat nosi
svoj `n`; nema agregata bez njega.

**3. `0 === 0` je zamka koja bi zaključala §4.** Naivni `played === total` za freeze je
točan za završen turnir i **katastrofalan** za tek onboardano natjecanje: prazna sezona ga
zadovoljava, proglasi se arhivom i zamrzne poslove koji je trebaju napuniti — sezona koja
nikad ne može početi. Otud `total > 0` u `isSeasonComplete`, s vlastitim testom. Pravilo je
namjerno o *poznatim utakmicama*, ne o veličini turnira: nema konstante oblika 104 koja bi
preživjela u §4 (test pokriva i ligu od 380).

**4. `refresh --full` je bio jedini stadij bez gatea.** Sync gate, ko gate i publish gate su
postojali; hourly refresh je i nakon finala svaki sat dizao Chrome i zvao mrtvi proxy.
Novi `should-refresh.ts` to zatvara, i **fail-OPEN** je (za razliku od sync gatea): refresh
ne troši kredite, pa kvar koji ne smijemo dopustiti nije „potrošen kredit" nego „tiho
zamrznuta živa sezona".

**5. Zamrznuti SKIP mora zvučati drugačije od „između kola".** Isti tekst u oba slučaja je
točno ono zbog čega su ispadi 2026-06/07 mjesec dana prošli neopaženo. Sad piše
`sezona arhivirana (104/104 odigrano)`. Heartbeat se i dalje piše na svakom ticku uključujući
zamrznuti — potvrđeno nakon deploya: `ingest tick svjež (0.0 h)`, banner se ne prikazuje.

**6. `.env` postavlja `SUPABASE_DB_URL` i to nije isto što i default.** `should-sync` se
pokreće s `--env-file-if-exists=.env`, `should-publish` bez njega — dakle s *različitim
vjerodajnicama*. Provjereno: isti host/port/baza, razlikuje se samo korisnik/lozinka, pa u
praksi nema razilaženja i novi gate radi identično s `.env` i bez njega. Ali ako se ikad
promijeni host u `.env`, dva gatea bi čitala dvije baze. **Za §4: ujednačiti pokretanje.**

**Regresija (crvena linija):** digest `wc2026_match` **bit-identičan prije i poslije**
(`0153c0b9424e105c38de054450a3009f`), publish gate SKIP, 90/90 testova, typecheck i build
čisti, live `/`, `/scorecard`, `/bracket`, `/accuracy`, `/blog` sve 200.

> ⚠ **Ispravak dokumentacije:** §2 epilog gore navodi digest `c6cb0df6…` kao referentnu
> vrijednost. Ta vrijednost **više ne vrijedi** — stvarni digest zadnjeg publisha (i trenutnog
> stanja baze) je `0153c0b9…`, zapisan u `fetcher/snapshot/.last-publish-digest` 20.7. u
> 01:45. Baza i objavljeni snapshot su u skladu (gate SKIP), pa je razlika povijesna, ne kvar.
> Za buduće regresijske provjere koristiti `0153c0b9…`, odnosno — bolje — pročitati aktualnu
> vrijednost iz `.last-publish-digest` umjesto oslanjanja na broj prepisan u dokumentu.

**Sitno usput:** dva UI stringa (`bracket.note`, hr+en) spominjala su izvor podataka poimence —
uklonjeno po standalone pravilu brenda. Iz `docs/20` uklonjen zalutali `</content></invoke>`
artefakt s kraja datoteke; A4 označen ✅.

---

## 4. PROMPT — Generalizacija, faza 1: registry natjecanja + KV namespacing

**Analiza (inventura codebase-a, 2026-07-20):** dobra vijest — **shema baze je stvarno
league-agnostička** (season/tournament su stupci; jedina WC iznimka je view
`wc2026_match` s literalom `58210`, migracija `20260607160000_wc_core_schema.sql:158`),
**Dixon-Coles jezgra je čista** (`model.ts` bez ikakvog WC filtera, half-life je
parametar; `dc-data.ts:loadDcMatches` trenira na SVIM team_match zapisima — točno što
želimo i za klubove), a **ingest SQL je posvuda parametriziran** (`season_id = $1`).
Loša vijest: identitet natjecanja je **zamrznuta konstanta** `WORLD_CUP` u
`fetcher/src/config.ts:99-104` (izvan zod sheme, bez env overridea!) koju importa ~20
modula, na tri mjesta stoji sirovi literal (regex `unique-tournament/16` u
`refresh.ts:83`, `diagnose.ts:13`, view u migraciji), a **KV ključevi su globalni**
(`core`, `hist:{teamId}`, `evs:{shard}`, `mser:{shard}` — `export-snapshot.ts:424`,
`web/lib/data-snapshot.ts:53`) pa dva natjecanja u istom namespaceu kolidiraju.

```text
Radiš u /Users/ms/git/DeoOptimoMaximo/Pediludium. Pročitaj ARCHITECTURE.md i docs/21 §4
(analiza s file:line referencama — slijedi ih, inventura je svježa). Cilj faze 1:
JEDAN kodebase može voziti VIŠE natjecanja istog formata (npr. WC2026 arhiva + sljedeći
turnir), bez ijedne promjene ponašanja za WC2026. Bez UI redizajna (to je faza 2).

A) COMPETITION REGISTRY — zamijeni konstantu WORLD_CUP (config.ts:99) registrom:
   competitions.ts s zapisima { key: 'wc2026', uniqueTournamentId: 16, categoryId,
   slug, seasonId: 58210, format: 'groups+ko', hosts: ['US','MX','CA'], … } i
   aktivnim natjecanjem biranim env varom (COMPETITION=wc2026 default). Provuci kroz
   svih ~20 importera (refresh, backfill, simulate, dixon-coles, dc-market, scheduler,
   should-sync, should-resolve-ko, resolve-knockout, map, probe, export-snapshot,
   edge/*…). Ukloni sirove literale: WC_EVENTS_RE u refresh.ts:83 izvedi iz
   uniqueTournamentId; diagnose.ts:13 isto. probe.ts već zna razriješiti season id iz
   tournament id-a na runtimeu — iskoristi ga za onboarding novog natjecanja
   (npm run probe -- --competition=X ispiše dostupne sezone).
B) VIEW → PARAMETRIZIRANI PRISTUP — wc2026_match view (migracija :158) koriste
   web/lib/data-supabase.ts:14-129, edge-supabase.ts:59 i edge/match-link.ts:109.
   Nova migracija: generički view competition_match (bez WHERE season) ili funkcija;
   čitatelji filtriraju po season_id iz registra. Stari view ostavi (backcompat).
C) KV NAMESPACING — prefiksiraj SVE ključeve competition keyem: wc2026:core,
   wc2026:hist:{id}… u export-snapshot.ts (:16-25,:207,:424) i web/lib/data-snapshot.ts
   (:53,:112,:122-135). Web bira aktivno natjecanje build/env varom (postojeći
   NEXT_PUBLIC_* obrazac). MIGRACIJSKA ZAMKA: publish radi diff prema postojećem
   stanju — prvi publish s novim ključevima je pun upload (~180 ključeva), stari
   ne-prefiksirani ključevi ostaju kao smeće; dodaj jednokratni cleanup skript.
   ⚠ KV free tier = 1000 upisa/dan (memorija „KV write limit") — prvi full upload
   potroši ~200; napravi ga u jednom danu bez drugih migracija.
D) TESTOVI — postojeći vitest setup; dodaj test da registry lookup + key-prefiks
   funkcije rade i da za COMPETITION=wc2026 SQL upiti generiraju identične parametre
   kao danas (regresija = nula promjene za WC).

Kriterij prihvaćanja: typecheck + testovi prolaze; FORCE_PUBLISH=1 snapshot za wc2026
objavi identičan sadržaj pod novim ključevima; site radi; hipotetski drugi zapis u
registru ne dira wc2026 podatke.
```

---

## 5. PROMPT — Generalizacija, faza 2: format-strategy + klubovi (lige)

**Analiza:** format turnira je najdublje ukopan i **tripliciran**: topologija brojeva
utakmica FIFA bracketa (73/89/97/101/103/104) postoji u `simulate.ts:77-93`,
`should-resolve-ko.ts:26` i `web/app/bracket/page.tsx:19-29`; `simulate.ts` dalje
pretpostavlja grupe A–L (`:60-69`), točno 4 momčadi po grupi (`:324`), 8 najboljih
trećih (`:337`), FIFA tie-breakere bez head-to-heada (`:295`) i jednoutakmični knockout
s bacanjem novčića za penale (`:390-399`). Liga nema ništa od toga. Uz to je klupski
identitet blokiran na dva mjesta: `is_national=true` filteri (data-supabase.ts:93,107,
simulate.ts:193, dixon-coles.ts:33, dc-data.ts:84) i **zastavice kao jedini vizual**
(`format.ts:11-31` mapira alpha2 → emoji; klub treba grb/sliku). Domaći teren: WC
pretpostavka „neutralan stadion" je globalna u kodu — `dc-data.ts:97-98` guši fitani
`gamma` na 0.35 osim za hardkodirane domaćine `US/MX/CA` (`:9-10`), zrcaljeno u
`simulate.ts:31-33`; liga treba puni `gamma` i nema koncept domaćina turnira.

```text
Radiš u /Users/ms/git/DeoOptimoMaximo/Pediludium. Preduvjet: docs/21 §4 (registry)
mergean. Pročitaj docs/21 §5 analizu s file:line referencama. Cilj: podržati klupsku
ligu (pilot: jedna liga po izboru korisnika — pitaj koju, npr. HNL ili Premier League;
SofaScore unique-tournament id upiši u registry) uz zadržavanje groups+ko formata za
turnire. Radi u ovim koracima, svaki zasebno testabilan:

A) FORMAT STRATEGY — izvuci topologiju natjecanja u jedan modul (format.ts u fetcheru +
   dijeljena definicija za web): tip 'league' (dvokružni round-robin, tablica, bez
   bracketa) i tip 'groups+ko' (postojeće ponašanje, s topologijom bracketa kao
   PODATKOM u registru umjesto triplicirane konstante — jedan izvor istine koji
   troše simulate.ts, should-resolve-ko.ts i bracket UI). Tie-breakeri kao
   konfigurabilan lanac (FIFA: pts→GD→GF; lige često pts→H2H→GD — implementiraj
   H2H usporedbu). Monte-Carlo za ligu: simuliraj preostale kola iz DC matrice,
   izlaz = distribucija konačnog plasmana (p_title, p_top4, p_relegation) —
   struktura tournament_simulation to već može primiti.
B) DOMAĆI TEREN — u registry dodaj homeAdvantage: 'full' | 'neutral-tournament';
   za 'full' homeEdge() vraća puni gamma (bez dampinga, bez hosts seta); postojeće
   konstante GROUP_HOME_DAMP/KO_HOME_DAMP/HOST_BUMP vrijede samo za
   'neutral-tournament'. dc-data.ts:97 i simulate.ts:245-251,391.
C) KLUPSKI IDENTITET — ukloni is_national=true pretpostavke (filter po članstvu u
   sezoni natjecanja umjesto po tipu momčadi); u team tablici iskoristi raw jsonb za
   logo/crest referencu; format.ts flag() dobiva fallback lanac: klupski grb (slika,
   self-hostana — NE hotlink na SofaScore, standalone pravilo brenda!) → emoji
   zastavica → inicijali. Provjeri Twemoji font hack (memorija: cross-browser
   zastavice) da ne pukne za ne-zastavice.
D) WEB NAVIGACIJA PO FORMATU — Nav.tsx:26-32: za 'league' sakrij /groups i /bracket,
   pokaži /table (nova stranica: tablica + p_plasman iz simulacije); /fixtures,
   /predictions, /accuracy, /movers rade za oba formata (provjeri queryje).
   Hardkodirani WC copy u i18n.ts (:216-438) i layout.tsx (:11-15) parametriziraj
   imenom natjecanja iz registra. „Naši" (HR highlight, page.tsx:33) neka bude
   followedTeam polje u registru, ne hardkod.
E) INGEST ZA LIGU — refresh želi-matcher već filtrira po uniqueTournamentId (radi za
   ligu); resolve:ko za 'league' je no-op; standings.ts računa ligašku tablicu s
   konfiguriranim tie-breakerima. Enrich/backfill NE diraj (čekaju piggyback migraciju).

Kriterij prihvaćanja: COMPETITION=wc2026 ponašanje bit-identično (regresijski testovi
iz §4D prošireni na simulate izlaz sa seedanim RNG-om); pilot liga: refresh povuče
raspored, DC predikcije izračunate (model već trenira na svim team_match podacima),
tablica + simulacija plasmana na webu pod svojim KV prefiksom.
```

---

## 6. PROMPT — Nadogradnje modela (neovisno o generalizaciji)

**Analiza:** roadmap već postoji u docs/08; edge backtest (docs/16, memorija) pokazao je
ROI −9.3% flat — model nije spreman za trading, ali je kalibracijski sloj sad
odblokiran: 104 završene utakmice + završni izvještaj iz §3A daju prvi pravi
kalibracijski dataset. Enrich (xG/postave/kvote) i dalje čeka piggyback migraciju
(docs/15 checklist) — to je preduvjet za xG-blend.

```text
Radiš u /Users/ms/git/DeoOptimoMaximo/Pediludium. Pročitaj docs/08 (roadmap modela),
docs/21 §3A (završni accuracy izvještaj) i memoriju o dc-market-v1 blendu. Zadatak:
1) IZOTONIČKA KALIBRACIJA — iz prediction vs ishod (104 utakmice) fitaj po-modelu
   kalibracijsku krivulju (izotonička regresija po ishodu H/D/A, ili Platt ako je
   premalo podataka po binu — odluči i obrazloži); novi model_version
   'dixon-coles-v1-cal' upisuje kalibrirane p; /accuracy ih uspoređuje s
   nekalibriranima. NE briši postojeće retke (append, povijest je sveta).
2) POST-MORTEM 1x2 UNDERDOG SIGNALA — docs/16 backtest kaže da je 1x2 underdog glavni
   gubitnik a ou25 break-even: analiziraj je li kalibracija iz 1) retroaktivno
   popravila edge selekciju (re-run backtesta nad istim snapshotom okladbi) i
   zapiši zaključak u docs/16.
3) Tek NAKON piggyback migracije enricha: xG-weighted strength po docs/08.
Kriterij: /accuracy pokazuje kalibrirani model s boljim (ili pošteno dokumentirano
lošijim) Brierom; docs/16 dopunjen post-mortemom.
```

---

## 7. Dugoročno upravljanje repoom (bez prompta — smjernice za vlasnika)

- **Redoslijed:** §1 (odmah) → §2 (ovaj tjedan — sustav je sad bez alarma!) → §3
  (dok je WC svjež) → §4 → §5 → §6. §4/§5 su najveći zalogaji; §4 je preduvjet §5.
  Svaki prompt = jedna sesija/branch; regresijski kriterij „WC2026 bit-identičan"
  je crvena linija kroz sve.
- **Trošak u mirovanju** (između natjecanja): s §2B/§3B gate-ovima ≈ 0 Firecrawl
  kredita, ≈ 0 KV upisa; jedini fiksni trošak je Mac koji vrti launchd. Health-check
  iz §2 je jedino što se stvarno mora vrtjeti stalno.
- **Transport je i dalje najveći rizik** (SofaScore challenge, docs/15/19): za ligu s
  utakmicama svaki vikend Firecrawl put (rezultati) je dovoljan i predvidiv
  (~1 kredit/utakmica); piggyback/enrich migracija ostaje „nice to have" dok se ne
  pojavi potreba za xG. Ne ulagati u 24/7 proxy prije nego što §5 pilot pokaže da
  liga uopće živi.
- **Konvencije koje čuvati:** docs/ numerirani zapisi odluka (ovaj je 21); memorija
  agenta ↔ docs sinkronizirani; standalone brend pravilo (nikad SofaScore trag u
  UI/asetima); tajne po secrets-zero-leakage konvenciji; svaka promjena modela =
  novi model_version, stare predikcije se nikad ne prepisuju.
- **Za buduće agente:** prije rada pročitati ARCHITECTURE.md + ovaj dokument;
  inventura u §4/§5 je snimka na 2026-07-20 — file:line reference će driftati,
  ali popis *područja* ostaje.

