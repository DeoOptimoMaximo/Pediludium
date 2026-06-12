# Pediludium — Arhitektura

> Otvorena nogometna analitika za **Svjetsko prvenstvo 2026** (48 reprezentacija, SAD/Kanada/Meksiko).
> Javni brend: **„Lopta je okrugla"** · [nogomet.domovina.ai](https://nogomet.domovina.ai)
>
> Ovaj dokument je holistički pregled cijelog sustava. Pojedine teme detaljno pokrivaju
> numerirani dokumenti u [`docs/`](docs/) (referencirani kroz tekst).

---

## 1. Što je projekt

Pediludium dohvaća podatke o utakmicama sa SofaScorea, sprema ih u Postgres, računa
**transparentne statističke predikcije** (Dixon-Coles model golova + Monte-Carlo simulacija
turnira), te servira rezultate kao statične snapshote na Cloudflare rubu. Cilj nije „crna
kutija koja pogađa", nego **provjerljiv** model: svaka predikcija se zamrzne prije utakmice i
naknadno ocijeni (Brier / log-loss) na stranici `/accuracy`.

Monorepo, tri dijela:

| Dio | Tehnologija | Uloga |
|-----|-------------|-------|
| `fetcher/` | Node 22+ / TypeScript (ESM) | ingest sa SofaScorea, modeli, export snapshota |
| `supabase/` | Postgres (Supabase, lokalni Docker) | jedini izvor istine za podatke |
| `web/` | Next.js (OpenNext → Cloudflare Workers) | javni UI, čita samo snapshote iz KV-a |

---

## 2. Topologija sustava

```mermaid
flowchart TB
    subgraph SS["SofaScore (neslužbeni /api/v1)"]
        SSAPI["Varnish edge + per-request challenge"]
    end

    subgraph PROXY["iPhone 15 Pro — mobile-phone-proxy"]
        MP["HTTP CONNECT :8888<br/>egress = Telemach mobilni IP"]
    end

    subgraph HOME["Kućni Mac (rezidencijalni IP)"]
        FET["fetcher (Playwright Chrome)<br/>refresh · enrich · predict · simulate · export"]
        PG[("Postgres / Supabase<br/>izvor istine")]
        LD["launchd — hourly cron"]
    end

    subgraph CF["Cloudflare"]
        KV[("Workers KV<br/>snapshot ključevi")]
        R2[("R2 bucket<br/>arhiva po satu")]
        W["Worker (Next.js / OpenNext)"]
    end

    USERS(["Posjetitelji<br/>nogomet.domovina.ai"])

    LD --> FET
    FET -- "Tailscale" --> MP
    MP -. "SPA pozivi prolaze 200" .-> SSAPI
    FET <--> PG
    FET -- "npm run snapshot<br/>(diff-upload)" --> KV
    FET -- "arhiva" --> R2
    W -- "čita po ključu" --> KV
    USERS --> W
```

Ključno: **fetcher je jedini pisac u Postgres**, a **web čita isključivo snapshote iz KV-a** —
nikad direktno iz baze ni sa SofaScorea. To drži javni site brzim i otpornim (rub poslužuje
statične JSON-e), a cijela ingest/compute kompleksnost ostaje na kućnom stroju.

---

## 3. Transport sa SofaScorea — i zašto je ovako kompliciran

SofaScore aktivno brani neslužbeni API. Kroz vrijeme su se nizale prepreke (kronologija u
[`docs/07`](docs/07-day1-probe-results.md), [`docs/09`](docs/09-egress-and-rate-limits.md),
[`docs/15`](docs/15-sofascore-challenge-and-piggyback.md)):

1. **TLS/HTTP fingerprint** — `curl`/`undici` dobivaju 403 i s rezidencijalnog IP-a. Rješenje:
   pravi **Google Chrome** preko Playwrighta (`channel: 'chrome'`) — autentičan fingerprint.
2. **Per-request „challenge" (od 2026-06-11)** — i pravi Chrome dobiva
   `403 {"reason":"challenge"}` na direktne `/api/v1` pozive. Potpis (`x-requested-with`)
   računa njihov obfuscirani JS po zahtjevu; ne može se replicirati. Deep-link stranice
   (`/match/...`, tournament) vraćaju 403 i na sam HTML — učitavaju se **samo ulazne stranice**.
3. **IP eskalacija** — previše automatiziranih zahtjeva s istog IP-a podigne blok na razinu IP-a.

### Rješenje: piggyback kroz mobilni IP

Umjesto da **mi** tražimo endpointe, pustimo **SPA da ih dohvati** pa uhvatimo njegove
odgovore (`page.on('response')`). SPA-ovi pozivi nose ispravan potpis i prolaze 200. Egress
ide kroz **iPhone mobile-phone-proxy** (svjež mobilni IP zaobilazi IP-eskalaciju).

```mermaid
sequenceDiagram
    participant F as fetcher (Chrome)
    participant P as iPhone proxy<br/>(Telemach IP)
    participant S as SofaScore SPA
    participant DB as Postgres

    F->>P: CONNECT www.sofascore.com (Tailscale)
    P->>S: GET /football  (mobilni IP)
    S-->>P: 200 HTML + JS
    P-->>F: 200
    Note over F,S: SPA se hidrira i SAM zove /api/v1
    S->>P: GET /unique-tournament/16/.../events/next/0
    P->>S: (potpisan, prolazi)
    S-->>F: 200 JSON (cijeli WC raspored, ~217 KB)
    Note over F: harvest() hvata response.body()
    F->>DB: upsert svih WC (turnir 16) evenata
```

Implementacija: `browser.ts` → `warmEntry()` (sleti na dopuštenu ulaznu stranicu) +
`harvest(navigate, want)` (hvata `/api/v1` odgovore koji matchaju `want`). `refresh.ts` →
`refreshViaPiggyback()` harvesta `/football` i upserta raspored + rezultate.

> **Caveat (iOS):** proxy listener se suspendira kad app ode u pozadinu / ekran se zaključa.
> Telefon mora ostati budan/foreground. Za 24/7: Android build (hardened) ili Windows
> „parked-node". Ako proxy spava → `refresh` upserta 0 i upozori; ostatak pipelinea vrti na
> postojećim podacima (stale-but-consistent).

> **Status:** `refresh` (raspored + rezultati) radi preko piggybacka. `enrich` + `backfill`
> još koriste direktni path → onemogućeni dok se ne migriraju na match-view harvest.

---

## 4. Politeness sloj

Svaki poziv ide kroz jedan serijski red (`PoliteClient`, `politeness.ts`): nasumični delay +
jitter, eksponencijalni backoff, poštivanje `Retry-After`, i **circuit breaker** (nakon 4
uzastopna 403/429 pauza 15 min). Egress IP se bira u `browser.ts`:
`SOFA_PROXY_SERVER` (mobilni proxy) → `SOFA_SOURCE_ADDR`/`SOFA_VIA_IPHONE` (USB tether) →
default ruta. Detalji: [`docs/03`](docs/03-fetching-strategy.md),
[`docs/10`](docs/10-polite-fetching-playbook.md).

---

## 5. Podatkovni model (Postgres)

Shema je **generička i league-agnostička**; WC2026 se primjenjuje kao *scope filter*
(`season_id = 58210`), nikad hardkodiran u shemu. Pogled `wc2026_match` spaja imena momčadi.

```mermaid
erDiagram
    tournament ||--o{ season : ima
    season ||--o{ match : sadrži
    team ||--o{ match : "home/away"
    season ||--o{ standing : "grupne tablice"
    match ||--o{ prediction : "po modelu"
    match ||--o{ prediction_history : "po satu (append-only)"
    season ||--o{ tournament_simulation : "izgledi po momčadi"
    team ||--o{ simulation_history : "po satu (append-only)"
    team ||--o{ team_match : "10 god. povijesti"
    team ||--o{ team_rating : "Elo / DC"
    match ||--o| match_statistics : "xG/posjed (enrich)"
    match ||--o| match_lineups : "postave + missing (enrich)"
    match ||--o| match_odds : "1X2 implied (enrich)"
    match ||--o| match_votes : "glasovi (enrich)"
    match ||--o| match_shotmap : "udarci+xg (enrich)"

    match {
        bigint ss_id PK
        bigint season_id FK
        bigint home_team_id FK
        bigint away_team_id FK
        text status_type
        int home_score
        int away_score
        text group_name
        jsonb raw
    }
    prediction {
        bigint match_id FK
        text model_version
        float p_home
        float p_draw
        float p_away
    }
    tournament_simulation {
        bigint team_id FK
        text model_version
        float p_advance
        float p_win_cup
    }
```

- **`*_history`** tablice su append-only (jedinstveni ključ uključuje `captured_at`): svaki
  hourly tick zapiše trenutne predikcije/sime → kasnije crtamo kako se mišljenje mijenjalo i
  računamo kalibraciju. „Latest" tablice (`prediction`, `tournament_simulation`) se upsertaju.
- **`match_*`** (enrich) tablice: raw payload + nekoliko parsiranih stupaca (xG, implied 1X2,
  missing players…). Migracija `20260612090000_match_enrichment.sql`.
- `raw jsonb` se uvijek čuva — ako kasnije zatreba neko polje, ne moramo ponovno fetchati.

---

## 6. Modeli predikcije

```mermaid
flowchart LR
    TM[("team_match<br/>~4600 povijesnih")] --> DC

    subgraph DC["Dixon-Coles (dixon-coles-v1)"]
        direction TB
        W["eksponencijalno vremensko<br/>ponderiranje (half-life 540d)"]
        F["weighted MLE: attack/defense<br/>po momčadi + γ (dom) + ρ (niski rez.)"]
        W --> F
    end

    DC --> PRED["prediction<br/>p_home/draw/away · exp golovi"]
    DC --> MC

    subgraph MC["Monte-Carlo (mc-sim-v1)"]
        direction TB
        G["72 utakmice grupa:<br/>uzorak iz DC matrice golova"]
        K["FIFA tie-breakeri →<br/>8 najboljih trećih → ždrijeb 32"]
        I["20.000 iteracija<br/>(seeded RNG, reproducibilno)"]
        G --> K --> I
    end

    MC --> SIM["tournament_simulation<br/>p_advance · p_win_cup · …"]
    PRED --> CAL
    SIM --> CAL["/accuracy<br/>Brier + log-loss vs ishod"]
```

- **Dixon-Coles** (`model.ts` čista matematika, `dixon-coles.ts` driver): bivarijatni Poisson
  s τ-korekcijom niskih rezultata, fitan weighted MLE-om s vremenskim opadanjem. Detalji i
  invarijante: [`docs/13`](docs/13-simulation-model.md).
- **Monte-Carlo**: rekonstrukcija cijelog 48-momčadskog ždrijeba (uključ. utrku 12
  trećeplasiranih), 20k simuliranih turnira. Baseline `baseline-poisson-elo-v1` (Elo+Poisson)
  radi usporedno radi usporedbe na `/accuracy`.
- **Roadmap modela** (xG-blend, market/squad kovarijate, kalibracijski sloj):
  [`docs/08`](docs/08-prediction-roadmap.md). Enrich sloj (xG/kvote/postave) je infrastruktura
  za te nadogradnje.

---

## 7. Snapshot pipeline i KV struktura

`npm run snapshot` = `export-snapshot.ts` (SQL → JSON) + `publish-snapshot.ts` (diff-upload u
KV + arhiva u R2). Sve agregacije idu kroz `json_agg`/`json_build_object` u SQL-u da bigint
id-evi stignu kao JSON brojevi.

```mermaid
flowchart LR
    PG[("Postgres")] -->|SQL agregacije| EXP["export-snapshot.ts"]
    EXP --> KVB["kv-bulk.json<br/>(179 ključeva)"]
    KVB -->|diff vs zadnje| PUB["publish-snapshot.ts"]
    PUB --> KV[("Workers KV")]
    PUB --> R2[("R2 arhiva<br/>snapshots/{ts}.json")]
    KV --> WEB["web (data-snapshot.ts)"]
```

| KV ključ | Sadržaj |
|----------|---------|
| `core` | matches, predictions (po modelu), standings, ratings, sims, teams — jedan blob (~130 KB) |
| `hist:{teamId}` | povijest utakmica po momčadi (48 ključeva) |
| `evs:{shard}` | precomputani EventDetail, shardano `event_id % 64` |
| `mser:{shard}` | vremenske serije predikcija po utakmici, `match_id % 16` |
| `tser:{teamId}` | vremenske serije izgleda turnira po momčadi |
| `calib` | završene utakmice ocijenjene po modelu (Brier/log-loss) |
| `movers` | 24h delta izgleda prolaska/naslova po momčadi (`/movers`) |

Sharding po modulu drži broj KV upisa malim (per-event ključevi bi koštali tisuće upisa).
Web (`data-snapshot.ts`) čita po ključu, s per-isolate cacheom (60 s). Identičan facade
(`data.ts`) bira između `snapshot` (produkcija) i `supabase` (lokalni dev) backenda.
Detalji: [`docs/14`](docs/14-public-deploy-and-snapshots.md).

---

## 8. Hourly pipeline (launchd)

```mermaid
sequenceDiagram
    participant C as launchd (svaki sat)
    participant R as refresh (piggyback)
    participant M as predict:dc → simulate
    participant H as history:record
    participant S as snapshot
    participant CF as Cloudflare

    C->>R: refresh --full (preko mobilnog proxyja)
    R-->>C: raspored + rezultati upsertani
    C->>M: refit DC + 20k MC (DB-only)
    C->>H: zapiši trenutne predikcije/sime (append-only)
    C->>S: export → diff-upload
    S->>CF: KV put (izmijenjeni ključevi) + R2 arhiva
    Note over C,CF: enrich/backfill ZASAD onemogućeni<br/>(direktni API → challenge 403)
```

Lock (`mkdir /tmp/...lock`) sprječava preklapanje; neuspjeli korak se loga i lanac nastavlja
(„stale-but-consistent snapshot bolji od ničega"). Skripta: `fetcher/scripts/hourly-snapshot.sh`.

---

## 9. Web aplikacija

Next.js (App Router), HR default + EN (cookie `lang`), svijetla/tamna tema, brend
„Lopta je okrugla" (DOMOVINA logo, bez ikakvih SofaScore tragova u UI-u). Stranice:

`/` pregled · `/fixtures` raspored · `/groups` skupine · `/teams` + `/team/{id}` ·
`/predictions` · `/simulation` prognoza · **`/movers` najveći pomaci** · `/accuracy` kalibracija ·
`/match/{id}` + `/event/{id}` detalji.

Deploy: `cd web && npm run deploy` (OpenNext adapter → Cloudflare Worker). Build-time flag
`NEXT_PUBLIC_DATA_SOURCE=snapshot` bira KV backend.

---

## 10. Ključni identifikatori i pokretanje

| Stvar | Vrijednost |
|-------|-----------|
| WC2026 unique-tournament | `16` |
| WC2026 season id | `58210` |
| iPhone proxy (Tailscale) | `http://100.71.146.11:8888` |
| Lokalni Postgres | `postgresql://postgres:postgres@127.0.0.1:56322/postgres` |
| Web dev | `:3100` |

```bash
# fetcher (kroz mobilni proxy)
cd fetcher && npm install
SOFA_PROXY_SERVER=http://100.71.146.11:8888 npm run refresh   # raspored + rezultati
npm run predict:dc && npm run simulate                        # modeli (DB-only)
npm run snapshot                                              # export + publish (KV/R2)

# web
cd web && NEXT_PUBLIC_DATA_SOURCE=supabase npm run dev         # lokalni dev :3100
npm run deploy                                                # produkcija (Cloudflare)
```

---

## 11. Otvoreno / sljedeći koraci

- **Migrirati `enrich` + `backfill` na piggyback** (match-view harvest) — otključava xG-blended
  model, recap kartice, golden boot, standings. ([`docs/15`](docs/15-sofascore-challenge-and-piggyback.md) checklist)
- **24/7 egress** — Android/Windows parked-node umjesto iPhonea koji mora biti budan.
- **Nadogradnje modela** — xG-weighted strength, market/squad kovarijate, izotonička kalibracija
  ([`docs/08`](docs/08-prediction-roadmap.md)).
