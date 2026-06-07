# 07 — Dan 1 rezultati (probe, uživo 2026-06-07)

Zapis stvarnog izvođenja Dan-1 probea s residential IP-a (Telemach HR, Zagreb).
Kod: [`../fetcher`](../fetcher). Samples: `fetcher/.probe-samples/` (gitignored).

## ✅ Ključni rezultati

| Stavka | Vrijednost |
|--------|-----------|
| **World Cup 2026 season id** | **`58210`** (`/unique-tournament/16/seasons` → `"World Cup 2026"`) |
| unique-tournament id | `16` (potvrđeno) — **oprez:** season id `16` je World Cup **2006**, ne 2026 |
| Sudionici | **48 reprezentacija** (potvrđeno; Hrvatska `#4715`) |
| Otvaranje | **Mexico vs South Africa**, 2026-06-11 19:00 UTC, round 1 |
| `events/next/0` | 200, 30 utakmica, `hasNextPage=true` |
| `events/last/0` | **404** (očekivano — još nijedna WC2026 utakmica nije odigrana) |
| `events/live` (global smoke) | 200, ~184 živih nogometnih utakmica |

### National team id-evi (za Dan-2 backfill)

```
Algeria 4691, Argentina 4819, Australia 4741, Austria 4718, Belgium 4717,
Bosnia & Herzegovina 4479, Brazil 4748, Cabo Verde 4753, Canada 4752, Colombia 4820,
Côte d'Ivoire 4768, Croatia 4715, Curaçao 55827, Czechia 4714, DR Congo 4823,
Ecuador 4757, Egypt 4758, England 4713, France 4481, Germany 4711, Ghana 4764,
Haiti 7229, Iran 4766, Iraq 4767, Japan 4770, Jordan 4771, Mexico 4781, Morocco 4778,
Netherlands 4705, New Zealand 4784, Norway 4475, Panama 5164, Paraguay 4789,
Portugal 4704, Qatar 4792, Saudi Arabia 4834, Scotland 4695, Senegal 4739,
South Africa 4736, South Korea 4735, Spain 4698, Sweden 4688, Switzerland 4699,
Tunisia 4729, Türkiye 4700, Uruguay 4725, USA 4724, Uzbekistan 4723
```
(Mašinski čitljiv izvor istine: `fetcher/.probe-samples/_summary.json`.)

## ⚠️ Korekcija nalaza o blokadi (mijenja docs/03)

Pretpostavka iz [03](./03-fetching-strategy.md) ("hrvatski residential IP prolazi s
curl/axios + UA") **više ne vrijedi**. Dokazano s **istog IP-a, isti trenutak**:

| Klijent | Rezultat | Server |
|--------|----------|--------|
| curl / Node native `fetch` (undici), čak i s punim Chrome headerima + cookie pokušajem | **403** | `Varnish` (edge) |
| Pravi Google Chrome (149) | **200** | `nginx` (origin) |

**Zaključak:** blokada je po **TLS/HTTP fingerprintu klijenta**, NE po IP-u. Residential IP je
u redu; `undici`/curl imaju ne-browser TLS otisak koji Varnish odbija prije origina.

Dodatne potvrde:
- **Cookieji ne pomažu** i nisu potrebni — Chrome je dobio 200 bez ijednog auth headera.
  SofaScore **ne koristi cookieje** za auth nego sprema **access/refresh tokene u `localStorage`**
  (zato je cookie export bio prazan). Ti tokeni su za **user-specific** feature (favoriti, glasanje),
  NE za javne podatke koje pratimo. Ako neki budući endpoint vrati 401, token čitamo programatski
  iz iste Chrome sesije: `page.evaluate(() => ({...localStorage}))` — bez ručnog exporta.
- **Homepage `www.sofascore.com/` također 403** preko curl-a → blok je na razini cijelog edge-a
  za ne-browser klijente, ne per-endpoint.

## ✅ Odluka o transportu (implementirano)

**Fetcher dohvaća kroz pravi, programatski pokrenut Google Chrome** (Playwright
`channel: 'chrome'`) na ovom macOS stroju (residential IP) → navigira na API URL, čita JSON,
sprema u fajlove za kasniji import u bazu. Politeness sloj (delay/jitter/serijski/circuit
breaker) omata browser navigacije.

- `fetcher/src/browser.ts` — browser transport (primarni, dokazan).
- `fetcher/src/http.ts` — native fetch (blokiran fingerprintom; zadržan za referencu / druge hostove).
- Default headful (kako je dokazano); `SOFA_HEADLESS=1` za pozadinske runove.

**Firecrawl:** ključ spremljen (`fetcher/.env`, gitignored) za *enrichment iz drugih javnih
izvora*, NE za SofaScore — Firecrawl ide kroz cloud IP (rizik dvostrukog sloja blokade) i
odstupa od "fetcher kod kuće" dizajna; lokalni Chrome je dokazano rješenje.

## Sljedeće (Dan 2)
- Paginiraj `events/next` dok `hasNextPage=false` → cijeli raspored grupne faze.
- Po reprezentaciji `team/{id}/events/last/{page}` → povijest (preko Chrome transporta, velik delay).
- Shema baze + upsert po `ss_id` (raw + parsed). Vidi [04](./04-target-architecture.md).
