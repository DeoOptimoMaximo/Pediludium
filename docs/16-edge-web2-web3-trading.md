# 16 · Edge layer — Web2 ↔ Web3 odds, +EV/arbitrage, dry-run trading

Automatizirana integracija naših predikcija s **offchain** (hrvatske kladionice) i
**onchain** (Polymarket) tržištima, plus eksperiment automatiziranog otvaranja pozicija u
skladu s izračunima. Sve živi u `fetcher/` (isti stack: Node 24 ESM + zod + pg +
playwright-core), nije zaseban projekt.

## Tok podataka

```
Polymarket (Gamma+CLOB) ─┐
HR kladionice (harvest)  ─┼─→ edge_quote ──→ engine (+EV vs DC / arbitraža) ──→ edge_opportunity
                          │                        ↑                                  │
                          │              public.prediction (dixon-coles-v1)           ▼
                          └────────────────────────────────────────────→ paper-trade (DRY_RUN) ──→ edge_paper_order + edge_wallet
```

Normalizirani model: svaki venue → `edge_quote` (venue+event+market+selection →
decimal_odds / implied_prob / fair_prob, FK na naš `match`). Markets: `1x2`, `ou25`.
Selections: `home|draw|away|over|under`.

## Komponente (`fetcher/src/edge/`)

| Fajl | Uloga |
|---|---|
| `types.ts` | `NormQuote`, `MarketKind`, `Selection`, odds↔prob helperi |
| `db.ts` | upsert/čitanje edge_quote / opportunity / paper_order / wallet |
| `match-link.ts` | mapiranje vanjskog eventa (po imenima timova) na naš `match.ss_id`; alias-map (USA→United States, Korea Republic…) |
| `polymarket.ts` | Gamma discovery + CLOB book/midpoint, **read-only / bez autha** |
| `engine.ts` | overround removal → fair_prob; +EV vs DC; cross-venue arbitraža |
| `paper-trade.ts` | DRY-RUN izvršenje: Kelly sizing + risk limiti + fill protiv **stvarnog** PM order-booka + settlement |
| `books/` | pluggable HR-adapter framework + generički XHR harvester |

Entry skripte / npm: `edge:pm`, `edge:books`, `edge:scan`, `edge:trade`, `edge` (sve u jednom).

## Polymarket (Phase 3) — naučeno uživo (2026-06-12)

- **v2 stack** (cutover 28.4.2026): trading ide kroz `@polymarket/clob-client-v2`,
  collateral je **pUSD** (ne USDC.e). Read (Gamma + CLOB book) je nepromijenjen i bez autha.
- Cijena `p` (0..1 pUSD) → implied prob `p` → decimal odds `1/p`.
- WC marketi su pod Gamma tagovima `2026-fifa-world-cup` + `soccer`. Po utakmici postoji
  **više event-varijanti**: bare `"A vs. B"` = full-match 3-way moneyline; `"A vs. B - More
  Markets"` = totals/handicapi (uzimamo `O/U 2.5`); `- Second Half Result`, `- Halftime`,
  `- Player Props` itd. **preskačemo**. Moneyline market je binarni YES/NO gdje je
  `groupItemTitle` ime tima / `Draw (…)`; totals je **jedan** market s outcomes `[Over,Under]`.
- Gamma polja `outcomes` / `outcomePrices` / `clobTokenIds` dolaze kao **JSON stringovi
  unutar JSON-a** → parsiramo ručno.
- Verificirano: 296 quotes / 70 WC utakmica live.

## HR kladionice (Phase 2) — status

Recon (vendor potvrđen): SuperSport=in-house · PSK=Fortuna · Favbet=Betinvest ·
Germania=EGT content · CroBet=`lutrija.hr/crobet`. **Endpoint putanje su inferred** → traže
live kalibraciju (isti workflow kao SofaScore piggyback). `edge:books -- <id>` pokreće
discovery (proxied Chrome kroz iPhone/Telemach IP → zaobilazi i geo-gate) i logira kandidate
odds-XHR. Tek tada se piše `parse()` po booku (registry stubovi vraćaju [] dok se ne
kalibrira). Prioritet: SuperSport / PSK / Favbet (najčišći JSON feedovi).
Fallback za sharp consensus: `the-odds-api.com` (Pinnacle/Betfair; ne pokriva HR bookove).

## Engine (Phase 4) — kalibracijski guardovi

+EV je matematički točan (`edge = model_prob·odds − 1`), ali **GIGO**: DC model je trenutno
overconfident i najveći "edge" je tamo gdje se model najviše ne slaže s vrlo sigurnim
tržištem — što je upravo gdje je model najvjerojatnije u krivu. Zato:

- **Longshot guard**: preskači +EV kad market no-vig prob < `EDGE_MIN_MARKET_PROB` (0.06)
  ili odds > `EDGE_MAX_EV_ODDS` (6.0). Tržište je oštar prior na dugim koeficijentima.
- **Real-arb guard**: arbitraža zahtijeva ≥2 različita venue-a (single-venue "arb" iz
  midpointa je iluzoran — platio bi ask na svakoj nozi). Dok je samo Polymarket live, pošten
  broj arbitraža = 0.

## Trading (Phase 5) — sigurnost

- **`EDGE_DRY_RUN=true` je default.** Live put je namjerno guarded stub koji odbija slati
  stvarne narudžbe — going live traži clob-client-v2 + wallet + pUSD approvals (vidi
  `.env.example`).
- Dry-run: Kelly sizing (`EDGE_KELLY_FRACTION`), hard cap po poziciji (`EDGE_MAX_STAKE_USD`),
  dnevni exposure/loss limit (`EDGE_DAILY_LOSS_LIMIT_USD`). Fill se simulira hodanjem po
  **stvarnom** PM order-booku (`/book`) → realan slippage. Settlement po `match` rezultatu
  (1x2 winner_code, ou25 total vs 2.5) kreditira paper wallet.

## Tablice (migracija `20260612120000_edge_layer.sql`)

`edge_venue` · `edge_quote` · `edge_opportunity` · `edge_paper_order` · `edge_wallet`.
RLS public-read kao i ostale; jedini writer je fetcher.

## UI

`web/app/edge/page.tsx` (+ `web/lib/edge.ts`) — Web2↔Web3 1X2 board, +EV stream, bot/wallet
status, dnevnik simuliranih trgovina. Čita Postgres direktno (force-dynamic), neovisno o KV
snapshotu.

## Sljedeći koraci

1. Kalibrirati `parse()` za SuperSport/PSK/Favbet iz discovery outputa → prve cross-venue
   arbitraže postaju moguće.
2. Reliability/kalibracija DC modela prije nego se +EV uzme zaozbiljno (povezano s
   `/accuracy`).
3. Wiring u hourly pipeline (`scripts/hourly-snapshot.sh`) nakon što books rade.
4. Live trading tek nakon review-a: clob-client-v2, pUSD approvals, mali bankroll.
