# 01 — Legacy baseline (`sports-api-fetcher`)

Pregled kako je radio stari repo. Služi kao **referenca provjerenog ponašanja** — svaki
endpoint i mapiranje ovdje je već radio u praksi.

## Što je stari repo bio

Skup malih Node.js skripti koje dohvaćaju podatke sa SofaScorea i spremaju ih u **CSV/JSON**.
Bez baze, bez testova, bez frontenda — čisti ETL "po potrebi". npm ime: `sofa-to-csv`.

Stack: `axios` (HTTP), `express` (jedan POST endpoint), `json-2-csv` (izvoz), `minimist` (CLI args).
Miks ES modula (`.mjs`) i CommonJS (`.js`).

## Komponente

### 1. `endpoints/fetch-matches.js` — Express server (port 3000)
`POST /fetch-matches` s body `{ ss_team_id, team_slug, pagination_direction }`.
Pagira kroz `team/{id}/events/{next|last}/{page}` dok `hasNextPage` (limit 40 stranica) i
sprema **i mapirani i sirovi** rezultat u `./fetched-matches/`.

> ⚠️ Mane koje **ne** prenosimo: folder `./fetched-matches/` ne postoji (write puca);
> response se vrati kao `success` čak i kad fetch baci; greška se samo `console.log`-a.

### 2. `more-time-imports/sofa-events.mjs` — isti posao, ali CLI
`node sofa-events.mjs --ss-team-id=3001 --direction=last`. Praktički duplikat gornje logike.

### 3. `sofa-last-matches.mjs` — analiza lokalnog JSON-a
Računa W/D/L niz za zadani tim (`--ss-team-slug`).
> ⚠️ Bug: koristi `minimist` ali ga **ne importa** → `ReferenceError`.

### 4. `one-time-imports/*.mjs` — bootstrap referentnih podataka (4 skripte)
| Skripta | Endpoint | Izlaz |
|---------|----------|-------|
| `sofa-football-categories.mjs` | `/sport/football/categories` | popis kategorija (regije/zemlje) |
| `sofa-unique-tournaments.mjs` | `/config/default-unique-tournaments/HR` | popisni turniri za regiju |
| `sofa-unique-tournament-seasons.mjs` | `/unique-tournament/{id}/seasons` | sezone turnira |
| `sofa-season-standings-total.mjs` | `/unique-tournament/{id}/season/{sid}/standings/total` | tablica → timovi |

Generirani CSV-evi (HNL, La Liga, Serie A, Bundesliga, Ligue 1, PL, UCL, UEL — sezona 2024)
stoje uz skripte i korisni su kao primjeri oblika podataka.

## Model utakmice (mapiranje koje je radilo)

Iz `team/{id}/events/...` su vadili (vidi `fetch-matches.js`):

```js
{
  ss_id, start_timestamp, winner_code,            // winnerCode: 1=home, 2=away, 3=draw
  home_team_slug, ss_home_team_id,
  away_team_slug, ss_away_team_id,
  home_score_current, home_score_display, home_score_period_1, home_score_period_2, home_score_normal_time,
  away_score_current, away_score_display, away_score_period_1, away_score_period_2, away_score_normal_time,
  tournament_slug, ss_tournament_id, tournament_category_slug, ss_tournament_category_id,
  ss_season_id, season_year
}
```

W/D/L logika (iz `sofa-last-matches.mjs`): usporedba `homeScore.current` vs `awayScore.current`
ovisno o tome je li ciljani tim home ili away.

## Što prenosimo, a što ne

**Prenosimo (provjereno):** popis endpointa, oblik event objekta, paginaciju preko `hasNextPage`,
ideju "spremi i sirovo i mapirano".

**Ne prenosimo (anti-paterni):** CSV kao primarni format, copy-paste duplikat fetchera,
miks ESM/CJS, lažni success, nepostojeći izlazni folder, hardkodirani limiti, nedostatak
delaya/retryja, nepostojeći error handling. Sve to rješava dok [03](./03-fetching-strategy.md)
i [04](./04-target-architecture.md).
