# 19 · Otporna multi-transport arhitektura dohvata (residential proxy + rotirajući Firecrawl)

Vizualni i tekstualni zapis fetching sustava izgrađenog do 2026-06-14: kako **kontinuirano**
i **bez blokiranja** dohvaćamo svježe SofaScore podatke (rezultati + koeficijenti) dok teku
utakmice, kombinirajući **residential/mobilni proxy** (piggyback) i **Firecrawl render**
(rotirajući API ključevi, paralelna skala). Trajni zapis svega naučenog.

Povezano: `docs/15` (challenge + piggyback), `docs/09/10` (egress, politeness), `docs/14`
(deploy/snapshot), `docs/16/18` (edge sloj). Memorije: `firecrawl-sofascore-transport`,
`mobile-proxy-piggyback-transport`, `kv-write-limit-drift-gate`, `sofascore-challenge-block-2026-06`.

---

## 1. Problem: SofaScore challenge je eskalirao

SofaScore nema službeni API; koristimo `api.sofascore.com/api/v1/...`. Kroz vrijeme obrana je rasla:

```mermaid
timeline
  title Evolucija blokiranja i naš odgovor
  2026-06-07 : Datacenter IP → 403 : residential IP prolazi (TLS fingerprint)
  2026-06-09 : IP rate-limit : --via-iphone mobilni IP (USB tether)
  2026-06-11 : Per-request challenge : direktni /api/v1 = 403 i kroz mobilni IP : → piggyback (harvest SPA odgovora)
  2026-06-13 : Warm /football challenge : mobilni IP pool se flagira nakon aktivnosti
  2026-06-14 : Firecrawl render fallback : zaobilazi challenge kad mobilni put padne
```

Ključni nalaz: **challenge je per-request potpis**, a ne čisti IP-ban. Direktni API pada
i kroz residential i kroz Firecrawl. Prolaze samo **SPA-ovi vlastiti pozivi** (mobilni
piggyback) ili **renderirana stranica** (Firecrawl).

---

## 2. Tri transporta — koji se kada koristi

```mermaid
flowchart TD
  NEED["Treba svjež podatak"] --> KIND{Tip}

  KIND -->|"rezultati / raspored<br/>(jeftino, često)"| MOB
  KIND -->|"odds / rezultati kad<br/>mobilni padne"| FC
  KIND -->|"bilo što direktno"| DIR

  subgraph MOB["① Mobilni proxy piggyback (primarni, besplatan)"]
    M1["Chrome → iPhone proxy (Tailscale)<br/>egress = Telemach cellular IP"]
    M2["harvest() SPA /api/v1 odgovora"]
  end

  subgraph FC["② Firecrawl render (fallback, plaćeni krediti)"]
    F1["scrape www.sofascore.com/match/...<br/>kroz Firecrawl anti-bot infru"]
    F2["markdown (odds) / schema JSON (rezultati)"]
  end

  subgraph DIR["③ Direktni /api/v1 (MRTAV)"]
    D1["403 challenge — i res. i Firecrawl"]
  end

  M2 --> DB[("Supabase Postgres")]
  F2 --> DB
  DIR -.->|"✗ ne koristi se"| DB

  style DIR stroke-dasharray: 5 5
  style DB fill:#1b3a2b,color:#fff
```

| Transport | Egress | Što dohvaća | Trošak | Kad |
|-----------|--------|-------------|--------|-----|
| **Mobilni piggyback** | iPhone cellular (Tailscale) | raspored, rezultati, enrich | besplatno | primarni; svaki sat |
| **Firecrawl render** | Firecrawl rotirajuća infra | odds, rezultati | ~1–5 kredita/stranica | fallback kad mobilni padne / za odds |
| ~~Direktni API~~ | bilo koji | — | — | **mrtav (403)** |

---

## 3. Mobilni proxy piggyback (primarni put)

```mermaid
sequenceDiagram
  participant F as fetcher (Node)
  participant C as Chrome (Playwright)
  participant P as iPhone proxy (Tailscale)
  participant S as SofaScore SPA

  F->>C: warmEntry('/football')
  C->>P: HTTP CONNECT (egress = cellular IP)
  P->>S: GET /football
  alt warm prolazi (200)
    S-->>C: HTML + JS (SPA hidrira)
    C->>S: SPA fira /api/v1/* (potpisani pozivi)
    S-->>C: 200 JSON (events/next, /event/{id}, ...)
    C-->>F: harvest() vraća Map<path, body>
    F->>F: upsert u Postgres
  else warm 403 (challenge)
    Note over C,S: per-request challenge na entry stranici
    C-->>F: tolerantno nastavi (0 upserta), backoff floor
  end
```

**Zašto pada (naučeno 2026-06-14):** Telemach cikla **mali pool IP-ova** (npr.
`.79.25 / .68.104 / .89.87 / .86.32`). Svaki *svjež* IP radi **~1 warm prozor**, pa ga
SofaScore re-challenge-a nakon aktivnosti. Airplane toggle često vrati **isti** IP. Robusnost
ugrađena u `politeness.ts`/`browser.ts`:

- **backoff floor**: challenge 403 šalje `Retry-After: 0`; `0 ?? fallback` je bio 0 → instant
  hamer + breaker u ms. Sad `Math.max(retryAfterMs, jitteredBackoff)`.
- **tolerantni warm**: 403 na entry stranici više ne ruši run — retry s backoffom pa nastavi.

---

## 4. Firecrawl render (fallback transport)

Direktni `api.sofascore.com` daje 403 i kroz Firecrawl. Ali **render match stranice radi** —
Firecrawlova infra izvrši SPA, a podaci slete u izlaz.

```mermaid
flowchart LR
  subgraph IN["Kandidati iz DB"]
    O["odds: utakmice u prozoru<br/>now-3h … now+72h"]
    R["rezultati: počele a nisu finished<br/>now-60h … now+30min"]
  end

  subgraph FCR["Firecrawl CLI (rotirajući ključevi)"]
    KEYS["~/.config/firecrawl/keys.json<br/>+ rotate.sh"]
    SC["scrape www.sofascore.com/football/match/{slug}/{cid}"]
  end

  O -->|"--format markdown (1 kredit)"| SC
  R -->|"--format json --schema (~5 kredita)"| SC
  SC --> KEYS

  SC -->|"parseMarkdownOdds()<br/>1X2 → implied prob"| MO[("match_odds")]
  SC -->|"isti parse"| EQ[("edge_quote<br/>venue 'sofascore'")]
  SC -->|"schema: {home_score, away_score, status}"| MATCH[("match<br/>score+status update")]

  style MO fill:#1b3a2b,color:#fff
  style EQ fill:#1b3a2b,color:#fff
  style MATCH fill:#1b3a2b,color:#fff
```

**Odds** — `npm run edge:sofascore` (`edge-sofascore-odds.ts`): markdown render → parser
featured booka (`[1\ … +1600] [X\ … +400] [2\ … -400]`; američki/decimalni/razlomački →
decimal → implied), piše u **oba** storea. Validirano: Haiti 5.6% / draw 18.9% / Scotland 75.6%.

**Rezultati** — `npm run refresh:fc` (`refresh-firecrawl.ts`): schema ekstrakcija (LLM čita
stranicu — robusnije jer layout varira) → ažurira samo score/status. `REFRESH_FC_DRY=1` za
dry-run. Validirano: Qatar 1-1 Switzerland, Brazil 1-1 Morocco, Haiti 0-1 Scotland.

> ⚠ Za **odds** je markdown-grep dovoljan (fiksni widget). Za **rezultate** koristi **schema
> ekstrakciju** — glavni score nije uvijek na vrhu rendera, grep bi bio krhak.

---

## 5. Vizija: paralelna skala + rotirajući Firecrawl ključevi

Firecrawl uklanja ovisnost o krhkom mobilnom IP-u: stranice se dohvaćaju **paralelno** kroz
njegovu infru, a **rotacija API ključeva** (`rotate.sh`) drži kredite/limite svježima. Time je
batch update moguć na skali bez blokiranja.

```mermaid
flowchart TB
  subgraph SRC["Pool poslova (utakmice u prozoru)"]
    J1["match 1"]; J2["match 2"]; J3["match 3"]; Jn["… match N"]
  end

  subgraph ROT["Rotirajući Firecrawl ključevi"]
    K1["key A"]; K2["key B"]; K3["key C"]
    RS["rotate.sh<br/>(po kreditima/limitu)"]
  end

  J1 --> K1; J2 --> K2; J3 --> K3; Jn --> K1
  K1 & K2 & K3 --> CONC["Firecrawl concurrency<br/>(paralelni render)"]
  RS -.-> K1 & K2 & K3

  CONC --> PARSE["parse (markdown odds / schema rezultati)"]
  PARSE --> DB[("Supabase Postgres")]

  style DB fill:#1b3a2b,color:#fff
```

Trošak je kredit/stranica pa **nije za satni cron** na svemu — primjenjuje se ciljano (utakmice
u igri / blizu početka), dok mobilni piggyback ostaje jeftini primarni put kad prolazi.

---

## 6. Periodički update dok teku utakmice (puni lifecycle)

```mermaid
flowchart TD
  TICK["Satni tick (launchd)"] --> REF["refresh --full<br/>(mobilni piggyback)"]
  REF --> GOT{Dohvaćeno<br/>novo?}

  GOT -->|"da"| GATE
  GOT -->|"0 (mobilni blokiran)"| FCFALL["refresh:fc<br/>(Firecrawl rezultati)"]
  FCFALL --> GATE

  GATE{"should-publish.ts<br/>match-reality digest<br/>promijenjen?"}
  GATE -->|"ne (samo model drift)"| SKIP["SKIP — 0 KV writeova"]
  GATE -->|"da / live / force"| CALC["standings → predict:dc →<br/>simulate → history:record"]
  CALC --> SNAP["snapshot: export + KV/R2 publish"]
  SNAP --> COMMIT["commit digest (tek nakon uspjeha)"]
  COMMIT --> REMOTE[("nogomet.domovina.ai<br/>(KV snapshot)")]

  ODDS["edge:sofascore (par×dnevno)"] -.->|"market prior / sanity"| CALC

  style SKIP fill:#3a2b1b,color:#fff
  style REMOTE fill:#1b3a2b,color:#fff
```

**KV write gate** (`docs` ovdje, memorija `kv-write-limit-drift-gate`): DC fit koristi
wall-clock time-decay (half-life 540d) → svaki sat λ/μ se mrve → ~50 serija shardova se
prepiše bez ikakve promjene rezultata → ~1200 KV writeova/dan > free limit 1000. Gate
digesta **samo match-reality** (score/status/raspored) → publisha samo na pravu promjenu;
mirni sati = **0 writeova**.

---

## 7. Naučene lekcije (sažetak znanja iz ovog ciklusa)

| # | Lekcija |
|---|---------|
| 1 | **Challenge je per-request potpis**, ne IP-ban. Direktni API mrtav i kroz residential i kroz Firecrawl. Prolaze SPA-pozivi (piggyback) ili render (Firecrawl). |
| 2 | **Mobilni IP pool je malen i flagira se** nakon aktivnosti; svaki svjež IP = ~1 warm prozor; airplane toggle često vrati isti IP. |
| 3 | **Firecrawl render zaobilazi challenge** — pouzdan fallback neovisan o IP-u. Odds = markdown (1 kr), rezultati = schema (5 kr, layout varira). |
| 4 | **KV free limit = 1000 writeova/dan**; time-decay drift ga je probijao. Gate na match-reality digest rješava (drift ≠ signal). |
| 5 | **harvestMatchView body-capture je nepouzdan** (`resp.json()` "body unavailable"); odds put `/event/{id}/odds/1/all` JE točan, ali render/body capture flakao — Firecrawl je zaobišao i to. |
| 6 | **Model je form-based bez opponent-strength** → apsurdi (Maroko>Brazil, Haiti>Škotska). Tržišne odds (sad u `edge_quote`/`match_odds`) = prior/sanity; rezultati potvrdili promašaje (Brazil 1-1 Morocco, Scotland 1-0 Haiti). |
| 7 | **politeness**: `Retry-After: 0` + `?? fallback` = instant hamer; backoff floor + tolerantni warm su nužni. |

---

## 8. Runbook (komande)

```bash
# Primarni (mobilni piggyback) — full sync + publish; gate odlučuje hoće li objaviti
cd fetcher && bash scripts/hourly-snapshot.sh         # launchd ovo vrti svaki sat

# Fallback rezultati kad mobilni vrati 0 (Firecrawl schema)
REFRESH_FC_DRY=1 npm run refresh:fc                   # dry-run (provjeri prije pisanja)
npm run refresh:fc                                    # primijeni score/status

# Odds (market prior) — par puta dnevno / blizu početka
SOFA_FC_MAX=14 npm run edge:sofascore                 # → match_odds + edge_quote

# Nakon ručnog refresh:fc/odds, recompute + objavi:
npm run standings && npm run predict:dc && npm run simulate && npm run history:record && npm run snapshot

# Provjera mobilnog egressa (živost proxyja)
curl -s -x http://100.71.146.11:8888 --max-time 12 https://api.ipify.org

# Firecrawl status (auth + krediti)
firecrawl --status
```

---

*Stanje na dan 2026-06-14: KV write gate, transport otpornost, Firecrawl odds (`edge:sofascore`)
i Firecrawl rezultati (`refresh:fc`) su na `main`. Remote nogomet.domovina.ai servira svježe
rezultate (Qatar 1-1, Brazil 1-1 Morocco, Haiti 0-1 Scotland) preko KV snapshota.*
