# 13 — Dixon-Coles + Monte-Carlo tournament simulation

Implementacija koraka **#1** (Dixon-Coles) i **#5** (Monte-Carlo simulacija turnira) iz
[`08-prediction-roadmap.md`](./08-prediction-roadmap.md). Sve se računa **isključivo iz naše
baze** (`public.team_match`, `public.match`, `public.standing`) — **nula poziva na SofaScore**,
pa je sigurno za re-run u developmentu (vidi `sofascore-access` memoriju o rate-limitu).

## Što je dodano

| Dio | Datoteka | Output |
|-----|----------|--------|
| Čista matematika (no-IO) | `fetcher/src/model.ts` (+ `model.test.ts`) | DC fit, scoreline matrica, sampling, seeded RNG |
| Zajednički DB-loader | `fetcher/src/dc-data.ts` | `team_match` → trening set, host id-evi, home-edge |
| Predikcije | `fetcher/src/dixon-coles.ts` · `npm run predict:dc` | `prediction` rows, `model_version = dixon-coles-v1` |
| Simulacija | `fetcher/src/simulate.ts` · `npm run simulate` | `tournament_simulation` rows, `model_version = mc-sim-v1` |
| Tablica | `supabase/migrations/20260608100000_tournament_simulation.sql` | advance / round-reach / win-cup vjerojatnosti |
| Web | `/simulation` (Forecast), Adv% u `/groups`, model toggle u `/predictions` | — |

## Dixon-Coles model golova

Za utakmicu: `λ = exp(attack[home] − defense[away] + γ + homeEdge)`,
`μ = exp(attack[away] − defense[home])`. Fita se **weighted maximum likelihood** (gradient
ascent, analitički gradijenti) iz ~4.6k jedinstvenih povijesnih utakmica.

- **Low-score korekcija τ** (Dixon & Coles 1997) spaja ćelije 0-0 / 1-0 / 0-1 / 1-1 →
  popravlja podcjenjivanje neriješenih i tijesnih rezultata kod nezavisnog Poissona.
- **Eksponencijalno vremensko ponderiranje**: `w = exp(−ln2 · ageDays / halfLife)`,
  `halfLife = 540 dana` (~18 mj) → novije utakmice dominiraju ("recent form").
- **Identifikabilnost**: srednji attack fiksiran na 0 (attack/defense su konfundirani konstantom).
- Tipičan fit: `γ ≈ 0.47` (home ×1.6 iz mahom kvalifikacijske povijesti), `ρ ≈ −0.01`.

> **Napomena**: rating je **form-based** — bez opponent-strength/confederation težina (korak #2),
> pa timovi s lakim kvalifikacijama mogu izgledati visoko. To je svjesno ograničenje MVP-a;
> sljedeći upgrade po `docs/08`.

### Home-edge na turniru
Fitani `γ` dolazi uglavnom iz home/away kvalifikacija; na SP-u su gotovo svi tereni neutralni,
pa se za nominalnog domaćina `γ` priguši (`× 0.35` grupna faza, `× 0.20` knockout). **Domaćini
(US/MX/CA)** dobivaju pravi home boost (`+0.10` log) gdje god igraju.

## Monte-Carlo simulacija (mc-sim-v1)

Turnir se odigra `SIM_ITERS` puta (default **20 000**, ~1.3 s ukupno) sa **seediranim RNG-om**
(`SIM_SEED`, default 20260611 → reproducibilno):

1. **Grupna faza** — 72 utakmice se sampleaju iz DC scoreline matrice; tablice se rangiraju po
   FIFA tie-breakerima (bodovi → gol-razlika → dani golovi → ždrijeb).
2. **Najbolji trećeplasirani** — 12 trećih se rangira istim kriterijima, **8 najboljih** prolazi.
3. **Knockout bracket** se rekonstruira iz placeholdera u `match` (`homeTeam.name` /
   `awayTeam.name`): `1A`/`2C` (pobjednik/drugi grupe), `3B/3E/3F/3I/3J` (najbolji treći iz jedne
   od tih grupa), `W83`/`L101` (pobjednik/gubitnik utakmice br.). Slotovi `H1/H2/G1/G2` =
   pobjednik/drugi grupa H/G (izvor ih piše obrnuto). Igra se do finala; neriješeno u KO →
   penali kao 50/50.
4. Agregira se po reprezentaciji: `p_win_group`, `p_runner_up`, `p_third`, `p_advance` (R32),
   `p_r16/p_qf/p_sf/p_final`, `p_win_cup`, `exp_group_points`.

### Modelske pretpostavke (honest disclosure)
- **Numeriranje KO utakmica** (W73…W104) nije eksplicitno u podacima → koristi se **kronološko
  numeriranje unutar runde** (FIFA konvencija; jedini anchor). Provjereno: R16 slugovi troše svih
  16 R32 pobjednika točno jednom → stablo je konzistentno. Ova pretpostavka utječe **samo** na KO
  parove (dakle naslov-odds), **ne** na grupne vjerojatnosti.
- **Dodjela najboljih trećih** slotovima: bipartitno sparivanje (Kuhn) koje poštuje listu
  dopuštenih grupa po slotu — valjana dodjela konzistentna s prikazanim ograničenjima
  (ne nužno ista kao FIFA-ina interna tablica za svaku od 495 kombinacija).
- **Penali** = 50/50 (neutralno), bez modela jakosti u raspucavanju.

### Provjereni invarijanti (sanity, 2026-06-08)
`Σ p_win_cup = 1.000`, `Σ p_advance = 32`, `Σ p_win_group = Σ p_runner_up = Σ p_third = 12`,
`Σ p_final = 2`, `Σ p_sf = 4`; monotonost `advance ≥ r16 ≥ qf ≥ sf ≥ final ≥ win_cup` bez
prekršaja. Bracket rekonstrukcija je time dokazano ispravna.

## Pokretanje
```bash
cd fetcher
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres npm run predict:dc
SUPABASE_DB_URL=...                                                     npm run simulate
# tuning: SIM_ITERS=50000 SIM_SEED=7 npm run simulate
```
Web: `/simulation` (Forecast) prikazuje rang po `p_win_cup`; `/groups` ima Adv% kolonu;
`/predictions?model=dc|baseline` uspoređuje modele. Sve realtime preko `tournament_simulation`
publikacije.

## Backtesting (kad krene turnir)
Predikcije se spremaju **prije** kickoffa (`created_at`), s `model_version`. Po odigranoj grupi
usporedi `dixon-coles-v1` vs `baseline-poisson-elo-v1` Brier/log-lossom (docs/08) — objektivna
provjera je li DC stvarno bolji.
