# 18 · Edge layer — vizualni vodič (Web2 ↔ Web3 odds, +EV/arbitraža, dry-run trading)

Vizualni prikaz svakog koraka edge sloja izgrađenog 2026-06-12/13. Tekstualni detalji:
`docs/16`. Memorija: `pediludium-edge-layer`. Sve dijagrame renderira Mermaid.

---

## 1. Arhitektura — gdje sve živi

```mermaid
flowchart LR
  subgraph VEN["Venues (izvori koeficijenata)"]
    PM["Polymarket (Web3 / Polygon)<br/>Gamma + CLOB REST"]
    KAL["Kalshi (regulirana burza)<br/>trade-api REST"]
    SS["SuperSport (Web2 / HR)<br/>api/sbk WebSocket"]
  end

  subgraph FET["fetcher/src/edge/ (Node + TS)"]
    PMc["polymarket.ts"]
    KALc["kalshi.ts"]
    SSc["supersport.ts"]
    ML["match-link.ts<br/>(team-name + HR aliasi)"]
    ENG["engine.ts<br/>(+EV / arbitraža)"]
    TRD["paper-trade.ts<br/>(DRY_RUN)"]
  end

  subgraph DB["Supabase Postgres"]
    Q["edge_quote"]
    OPP["edge_opportunity"]
    ORD["edge_paper_order"]
    WAL["edge_wallet"]
  end

  subgraph OUT["Konzumenti"]
    SNAP["export-snapshot.ts<br/>KV key 'edge'"]
    WEB["web /edge<br/>(facade: supabase | snapshot)"]
  end

  PM --> PMc --> ML
  KAL --> KALc --> ML
  SS --> SSc --> ML
  ML --> Q
  Q --> ENG --> OPP
  OPP --> TRD --> ORD
  TRD --> WAL
  Q --> SNAP
  OPP --> SNAP
  ORD --> SNAP
  WAL --> SNAP
  Q --> WEB
  SNAP --> WEB
```

---

## 2. End-to-end pipeline (npm run edge)

```mermaid
flowchart TD
  A["npm run edge"] --> B["1 · Polymarket ingest"]
  A --> C["2 · Kalshi ingest"]
  A --> D["3 · SuperSport ingest<br/>(treba budan proxy)"]
  B --> E["upsert edge_quote"]
  C --> E
  D --> E
  E --> F["4 · scan (engine.ts)"]
  F --> G["overround removal -> fair_prob"]
  F --> H["+EV vs dixon-coles-v1"]
  F --> I["cross-venue arbitraža"]
  G --> J["edge_opportunity"]
  H --> J
  I --> J
  J --> K["5 · settle finished pozicije"]
  K --> L["6 · paper-trade (DRY_RUN)"]
  L --> M["edge_paper_order + edge_wallet"]
  M --> N["npm run snapshot -> KV 'edge'"]
  N --> O["web /edge (produkcija)"]
```

---

## 3. Ingest po venue-u — tri različita transporta

```mermaid
flowchart TD
  subgraph P["Polymarket — REST, bez autha"]
    P1["Gamma /events?tag_slug=2026-fifa-world-cup,soccer"] --> P2["filtriraj event varijante:<br/>'A vs B' = moneyline 1x2<br/>'- More Markets' = O/U 2.5"]
    P2 --> P3["CLOB /midpoint po tokenu<br/>cijena p -> odds 1/p"]
  end
  subgraph K["Kalshi — REST, bez autha"]
    K1["/markets?series_ticker=KXWCGAME"] --> K2["grupiraj po event_ticker<br/>yes_sub_title = tim / 'Tie'"]
    K2 --> K3["cijena iz *_dollars (ask, fallback last)<br/>-> odds 1/p"]
  end
  subgraph S["SuperSport — WebSocket, proxied Chrome"]
    S1["wss://www.supersport.hr/api/sbk"] --> S2["i_hr snapshot (B->S->C->T->FX)"]
    S2 --> S3["P price-update frameovi<br/>1m{sid} -> market '1' -> o{1,2,3}"]
  end
  P3 --> M["match-link.ts -> match.ss_id"]
  K3 --> M
  S3 --> M
```

---

## 4. SuperSport WS protokol — reverse-engineering (najteži dio)

```mermaid
sequenceDiagram
  participant C as Chrome (Playwright)<br/>+ iPhone proxy (HR IP)
  participant SS as SuperSport api/sbk
  C->>SS: goto /sport/day/N/sport/1 (otvara WS)
  C->>SS: subscribe {"t":1,"u":[{"s":"i_hr"}]}
  SS-->>C: i_hr snapshot (~1.25 MB)<br/>format: {header}\n{body}
  Note over C,SS: body = {B:{S:{"1":{C:{T:{FX:{...}}}}}}}<br/>FX[id] = {H,A,sid}, BEZ koeficijenata
  SS-->>C: P frame {"P":{"1m<sid>":{m:{"1":{l:{o:{...}}}}}}}
  SS-->>C: P frame ...
  Note over C: akumuliraj P state
  C->>C: za svaki fixture: key = "1m"+sid<br/>market "1" (regularno vrijeme)<br/>o.1/o.2/o.3 = dom/ner/gost
  C->>C: HR ime -> EN alias -> match WC fixture
```

> Razdjelnik framea je **newline** (`\n`), ne razmak — to je bila ključna prepreka.
> Imena su hrvatska (Njemačka, Maroko…) → HR→EN alias mapa u `match-link.ts`.

---

## 5. Engine — +EV i arbitraža s guardovima

```mermaid
flowchart TD
  Q["edge_quote (po match + market)"] --> OV["overround removal<br/>fair = implied / Σimplied"]
  OV --> EV{"+EV grana"}
  OV --> ARB{"Arbitraža grana"}

  EV --> EVg1{"odds <= 6.0 ?<br/>(longshot guard)"}
  EVg1 -- ne --> X1["odbaci"]
  EVg1 -- da --> EVg2{"market fair >= 6% ?"}
  EVg2 -- ne --> X1
  EVg2 -- da --> EVc["edge = model_prob × odds − 1"]
  EVc --> EVo{"edge >= 3% ?"}
  EVo -- da --> OPPe["edge_opportunity (ev)<br/>+ Kelly frakcija"]

  ARB --> ARBb["najbolje odds po ishodu (svi venue-i)"]
  ARBb --> ARBt["T = Σ 1/odds"]
  ARBt --> ARBg{"T < 1 i >= 2 venue-a ?"}
  ARBg -- ne --> X2["nije izvršiva arbitraža"]
  ARBg -- da --> OPPa["edge_opportunity (arb)<br/>profit = 1/T − 1, legs[]"]
```

---

## 6. Dry-run trade — životni ciklus pozicije

```mermaid
flowchart TD
  O["open +EV prilika"] --> G1{"EDGE_DRY_RUN = true ?"}
  G1 -- ne --> STOP["odbij (live je guarded stub)"]
  G1 -- da --> G2{"već otvorena za match+sel ?"}
  G2 -- da --> SKIP["preskoči"]
  G2 -- ne --> SIZE["stake = Kelly × bankroll<br/>cap $25, dnevni limit $100"]
  SIZE --> G3{"dnevni exposure < limit ?"}
  G3 -- ne --> HALT["zaustavi dan"]
  G3 -- da --> FILL["simuliraj fill protiv STVARNOG<br/>PM order-booka (VWAP, slippage)"]
  FILL --> REC["edge_paper_order (simulated)<br/>wallet −= stake"]
  REC --> SET["settle po rezultatu utakmice"]
  SET --> WIN{"pogođeno ?"}
  WIN -- da --> PAY["wallet += stake × fill_odds"]
  WIN -- ne --> LOSS["pnl = −stake"]
```

---

## 7. Deploy — snapshot facade (dev vs produkcija)

```mermaid
flowchart LR
  subgraph DEV["Lokalni dev"]
    D1["web/lib/edge-supabase.ts"] --> D2["Postgres (anon, RLS)"]
  end
  subgraph PROD["Cloudflare produkcija"]
    F1["fetcher: exportEdge() -> KV key 'edge'"]
    F1 --> P1["web/lib/edge-snapshot.ts"]
    P1 --> P2["Workers KV (SNAPSHOT)"]
  end
  FAC["web/lib/edge.ts (facade)<br/>NEXT_PUBLIC_DATA_SOURCE"] --> D1
  FAC --> P1
  FAC --> PAGE["app/edge/page.tsx"]
```

---

## 8. „Free money"? — kuda nestane 1.52% (reality-check)

```mermaid
flowchart TD
  S["Detektirani spread ~1.52%"] --> F["− fee floor<br/>(PM ~0.75% + Kalshi ~1.5%)"]
  F --> D["− dubina knjige<br/>(izvršivo ~$5-15, −95% profita)"]
  D --> L["− leg risk<br/>(noge nisu atomske)"]
  L --> R["− resolution risk<br/>(venue-i različito rješavaju isti market)"]
  R --> C["− kapital zaključan do namire"]
  C --> NET["Neto: break-even do negativno"]
  NET --> WHY["Zato: dry-run, ≥2-venue guard,<br/>signal ≠ izvršivi profit"]
```

Izvori: [arXiv 2605.00864](https://arxiv.org/html/2605.00864v1) (depth haircut −95.2%),
[arXiv 2601.01706](https://arxiv.org/html/2601.01706v1) (Law of One Price),
[Polymarket fees](https://docs.polymarket.com/trading/fees),
[Kalshi fees](https://kalshi.com/docs/kalshi-fee-schedule.pdf).

---

## 9. Cross-chain atomicity — zašto „istovremeno svugdje" ne ide

```mermaid
flowchart LR
  subgraph POLY["Polygon (EVM)"]
    PMl["Polymarket leg<br/>USDC.e / pUSD"]
  end
  subgraph SOL["Solana"]
    DF["DFlow tokenizirani Kalshi<br/>SPL yesMint/noMint, Solflare self-custody"]
  end
  PMl -. "NEMA atomskog<br/>cross-chain izvršenja" .- DF
  DF --> NOTE["'atomic' kod DFlow-a = unutar 1 Solana tx<br/>(jedna noga), NE preko lanaca"]
  PMl --> NOTE2["cross-venue par = i dalje 2 neatomske noge<br/>tokenizacija ubrzava SAMO Kalshi nogu"]
```

> DFlow (od 1.12.2025) tokenizira Kalshi pozicije na Solani (Solflare self-custody, 1:1
> redemption, ~zero added fee) — stvarno i korisno za **Kalshi leg + custody**. Ali
> Polymarket je na Polygonu → atomska cross-venue arbitraža i dalje ne postoji.
> Atomski bi bilo moguće tek kad bi obje noge bile na istom lancu (DFlow EVM "on the way").

---

## Sažetak — što je istina, što nije

| Tvrdnja | Status |
|---|---|
| Polymarket + Kalshi koeficijenti, normalizirani, usporedivi | ✅ radi, live |
| SuperSport (Web2) koeficijenti preko WS | ✅ radi (treba budan proxy) |
| Cross-venue arbitraža detekcija (≥2 venue-a) | ✅ radi (PM↔Kalshi) |
| Dry-run trgovanje sa stvarnim order-book fillom | ✅ radi |
| Kalshi tokeniziran on-chain (DFlow/Solana/Solflare) | ✅ istina |
| Arbitraža = „free money perpetuum mobile" | ❌ tanak/negativan nakon troškova |
| Atomska arbitraža istovremeno na svim venue-ima | ❌ različiti lanci, neatomski |
| Postoji gotov „plug keys & run" bot vrijedan povjerenja | ❌ ne (pmxt je jedina ozbiljna lib) |

**Single point of truth ostaje ovaj codebase.** Sljedeći smisleni koraci: DFlow API kao
Kalshi quote/execution izvor (bolje od tankog `last_price`), ostali HR bookovi (svaki je
zaseban WS), DC kalibracija prije nego se +EV uzme zaozbiljno.
