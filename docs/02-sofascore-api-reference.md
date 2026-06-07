# 02 — SofaScore API reference

> ⚠️ **Neslužbeni API.** `https://api.sofascore.com/api/v1/...`. Nema dokumentacije, nema
> garancija, nema ToS dozvole za scraping. Endpointi su stabilni godinama, ali se mogu
> promijeniti bez najave. Koristi odgovorno (vidi [03](./03-fetching-strategy.md)).

Legenda pouzdanosti:
- ✅ **provjereno** — korišteno u starom repou, radilo.
- ☑️ **poznato-stabilno** — široko korišteni endpointi, vrlo vjerojatno rade; **verificiraj prije oslanjanja**.

## Base & headers

```
BASE = https://api.sofascore.com/api/v1
```
Pošalji realan browser `User-Agent` i `Accept: application/json`. Bez API ključa.
Neki endpointi traže `Referer: https://www.sofascore.com/`. Sve su **GET** metode.

## Reference / bootstrap

| # | Endpoint | Vraća |
|---|----------|-------|
| ✅ | `GET /sport/football/categories` | kategorije (regije + zemlje), `category.id` |
| ✅ | `GET /config/default-unique-tournaments/{ALPHA2}` | istaknuti turniri za regiju (npr. `HR`) |
| ✅ | `GET /unique-tournament/{tid}/seasons` | sve sezone turnira → `season.id`, `season.year` |
| ✅ | `GET /unique-tournament/{tid}/season/{sid}/standings/total` | tablica; `standings[].rows[].team` |
| ☑️ | `GET /search/all?q={query}` | pretraga timova/igrača/turnira |

## Utakmice (matches / events)

| # | Endpoint | Vraća |
|---|----------|-------|
| ✅ | `GET /team/{teamId}/events/{next\|last}/{page}` | utakmice tima, pagirano; `events[]`, `hasNextPage` |
| ☑️ | `GET /unique-tournament/{tid}/season/{sid}/events/{next\|last}/{page}` | sve utakmice turnira/sezone |
| ☑️ | `GET /sport/football/scheduled-events/{YYYY-MM-DD}` | sve utakmice na dan |
| ☑️ | `GET /sport/football/events/live` | sve trenutno žive utakmice |
| ☑️ | `GET /event/{eventId}` | detalj jedne utakmice |

`next` = nadolazeće, `last` = odigrane. `page` počinje od `0`. Pagiraj dok `hasNextPage === true`.

## Detalji jedne utakmice (za realtime + za feature-e prediktora)

| # | Endpoint | Vraća |
|---|----------|-------|
| ☑️ | `GET /event/{id}/lineups` | postave, formacije, igrači |
| ☑️ | `GET /event/{id}/statistics` | statistika (posjed, šutevi, xG…) |
| ☑️ | `GET /event/{id}/incidents` | golovi, kartoni, izmjene (timeline) |
| ☑️ | `GET /event/{id}/h2h` *(varijante)* | međusobni omjer |
| ☑️ | `GET /event/{id}/odds/1/all` | kvote (ako dostupno) |

## Tim / reprezentacija

| # | Endpoint | Vraća |
|---|----------|-------|
| ☑️ | `GET /team/{id}` | detalj tima |
| ☑️ | `GET /team/{id}/players` | kadar / roster |

## Ključni identifikatori za World Cup 2026

Iz starog CSV-a (`sofa-unique-tournaments.csv`) pronađeno:

- **Turnir (World Cup):** `unique-tournament` **id = `16`**, slug `world-championship`.
- **Kategorija:** World/international **id = `1468`**.

**Što još treba dohvatiti (prvi korak ingesta):**

```bash
# 1) Pronađi season id za 2026
GET /unique-tournament/16/seasons        # traži year "2026" → zapamti season.id  (npr. 6XXXX)

# 2) Iz toga povuci sve utakmice turnira
GET /unique-tournament/16/season/{sid}/events/last/0   # odigrane (kvalifikacije/prijateljske se vode zasebno)
GET /unique-tournament/16/season/{sid}/events/next/0   # raspored grupne faze

# 3) Sudionici → iz standings ili iz scheduled events izvuci 48 reprezentacija (team id-evi)
```

> Reprezentacije se na SofaScoreu vode kao "team" s vlastitim `team/{id}/events/...`, pa za
> **povijesne utakmice svake reprezentacije** koristiš isti endpoint kao stari repo
> (`team/{id}/events/last/{page}`), samo s nacionalnim team id-evima.

## Oblik `event` objekta (skraćeno, provjereno)

```jsonc
{
  "id": 12345678,
  "startTimestamp": 1749600000,          // unix sekunde
  "winnerCode": 1,                        // 1=home, 2=away, 3=draw, (nedostaje => neodigrano)
  "status": { "code": 100, "type": "finished" },  // type: notstarted|inprogress|finished
  "homeTeam": { "id": 4711, "slug": "croatia", "name": "Croatia", "shortName": "CRO" },
  "awayTeam": { "id": 4712, "slug": "brazil",  "name": "Brazil",  "shortName": "BRA" },
  "homeScore": { "current": 2, "display": 2, "period1": 1, "period2": 1, "normaltime": 2 },
  "awayScore": { "current": 1, "display": 1, "period1": 0, "period2": 1, "normaltime": 1 },
  "tournament": { "slug": "...", "id": 0, "category": { "id": 1468, "slug": "world" } },
  "season": { "id": 0, "year": "2026" }
}
```
