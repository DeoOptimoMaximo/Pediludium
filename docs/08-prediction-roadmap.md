# 08 — Prediction roadmap (baseline → advanced)

Što je sada (MVP, `fetcher/src/predict.ts`, `model_version = baseline-poisson-elo-v1`) i
što bi bilo **najbolje koristiti** za ozbiljnu predikciju. Shema (`prediction.model_version`)
podržava više modela paralelno — napredni model dolazi *uz* baseline, ne umjesto njega.

## Baseline (implementirano)

- **Elo** fitan iz nedavne povijesti svake reprezentacije (`team/{id}/events/last/0`).
  Svi počinju na 1500 → zapravo je to **"recent form" rating**, ne apsolutna snaga.
  Sprema se u `team_rating` (power ranking za UI).
- **Nezavisni Poisson**: napad/obrana svake reprezentacije relativno na liga-prosjek →
  λ_home, λ_away (uz blagi home/host boost) → scoreline matrica 0–10 → `p_home/p_draw/p_away`
  + očekivani golovi. Sprema se u `prediction`.

**Poznata ograničenja (namjerno):** Elo bez povijesne inicijalizacije (recency bias),
miješanje prijateljskih i kvalifikacijskih utakmica bez težina, nezavisnost golova
(podcjenjuje 0:0/1:1), knockout placeholderi (npr. "Winner Group A") nemaju povijest →
neutralna predikcija dok se ne odigra grupa.

## Advanced — status (preporučeni redoslijed po omjeru korist/trud)

| # | Tehnika | Status | Zašto / što daje | Izvor podataka |
|---|---------|--------|------------------|----------------|
| 1 | **Dixon-Coles** | ✅ `dixon-coles-v1` (docs/13) | Korekcija za niske rezultate (0:0,1:0,0:1,1:1) + **eksponencijalno vremensko ponderiranje** (novije utakmice teže) | postojeća povijest |
| 2 | **Opponent/confederation adjustment** | ⬜ TODO (sljedeće) | Kvalifikacije UEFA ≠ CONCACAF; ponderiraj snagu protivnika i tip natjecanja | `tournament`/`category` iz eventa |
| 3 | **xG umjesto golova** | ⬜ TODO | Realizirani golovi su bučni; xG je stabilniji procjenitelj λ | `GET /event/{id}/statistics` |
| 4 | **Market-odds blend** | ⬜ TODO | Kvote su jak prior (tržište agregira sve); blendaj s modelom | `GET /event/{id}/odds/1/all` |
| 5 | **Monte-Carlo simulacija turnira** | ✅ `mc-sim-v1` (docs/13) | Iz per-match λ simuliraj cijeli turnir N×10⁴ → **vjerojatnost prolaska grupe / osvajanja SP-a** | naš `match` + DC fit |
| 6 | **Bayesian hierarchical / Bivariate Poisson** | ⬜ TODO | Dijeljena snaga napada/obrane, korelacija golova, nesigurnost (intervali) | PyMC/Stan offline → upiši `prediction` |
| 7 | **Gradient boosting** | ⬜ TODO | Feature eng.: forma, odmor, putovanje, vrijednost kadra, ozljede | više endpointa + vanjski |

> **Implementirano (2026-06-08):** koraci #1 i #5 — vidi [`13-simulation-model.md`](./13-simulation-model.md).
> Oba modela rade iz baze (nula SofaScore poziva), spremaju se uz baseline (`model_version`),
> i napajaju `/simulation` (Forecast) te `/predictions` toggle u webu. **Sljedeće: korak #2**
> (opponent-strength), jer DC rating je trenutno čisto form-based.

### Arhitektura napredne predikcije
- Trenira se **offline** (Python/PyMC ili TS), rezultat upisuje u `prediction` s novim
  `model_version` (npr. `dixon-coles-v1`, `mc-sim-v1`). UI bira/uspoređuje modele.
- Dodati tablice po potrebi: `match_statistics` (xG iz `/statistics`), `match_odds`,
  `tournament_simulation` (advance/win vjerojatnosti) — shema je proširiva.
- Predikcija se uvijek sprema **prije kickoffa** (`created_at`), s `model_version`, da ne
  curi rezultat i da se modeli pošteno backtestaju.

## Backtesting
Kad grupna faza počne: za svaku odigranu utakmicu usporedi `prediction` (spremljen prije)
sa stvarnim ishodom → **Brier score** i **log-loss** po modelu. To je objektivna metrika
koja kaže je li napredni model stvarno bolji od baselinea.
