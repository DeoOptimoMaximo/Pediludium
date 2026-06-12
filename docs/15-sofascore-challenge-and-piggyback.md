# 15 — SofaScore "challenge" blok i piggyback transport

## Što se dogodilo

Oko **2026-06-11 ~12:00 UTC** SofaScore je pooštrio anti-bot zaštitu. Simptomi u
`~/Library/Logs/pediludium/snapshot.log`: svaki hourly tick od ~14h lokalno vrti
`[refresh] schedule re-pulled: 0 matches`, a `[browser] 403 … — blocked` + circuit breaker
stalno OPEN. Predikcije i snapshot i dalje rade (DB-only), ali na **zamrznutim** podacima.

## Dijagnoza (dokazano, 2026-06-12)

Probe (alat `fetcher/src/diagnose.ts` ostaje; scratch verzije obrisane):

1. **Stari transport mrtav.** Bare `page.goto` na `api.sofascore.com/api/v1/...` → `403
   {"error":{"code":403,"reason":"challenge"}}`. Isto za `www` host i za in-page `fetch()`.
2. **Header spoofing ne pomaže.** Site na svaki uspješan poziv šalje `x-requested-with:
   <token>` (npr. `eea64d`). Hardkodiranje te vrijednosti → `403 "Forbidden"`. Token je
   per-session/PoW, računa ga njihov obfuscirani JS po zahtjevu — ne možemo ga replicirati.
3. **Samo site-ovi vlastiti pozivi prolaze.** Kad SPA sam dohvati URL, odgovor je 200 i
   možemo uhvatiti tijelo preko `page.on('response')` (dokazano: events feed + 10 data
   poziva na livescore stranici, svi 200).
4. **Deep-linkovi blokirani na razini HTML-a.** `/football/match/{slug}/{customId}` i
   tournament stranice → `403` na sam dokument (prazan `<title>`). Samo ulazne stranice
   (`/football`, livescore) se učitavaju.
5. **⚠ Eskalacija od probinga.** Nakon ~11 proba isti dan, i `/football` (ujutro 200) počeo
   vraćati 403 → IP/session-level rate-limit (docs/09). **Probing je prekinut** da se ne
   produbi blok na rezidencijalnom IP-u koji produkcija koristi.

## Smjer: piggyback (odluka korisnika 2026-06-12)

Umjesto da sami tražimo endpointe, pustimo SPA da ih dohvati pa **uhvatimo njegove
odgovore**. Pošto su deep-linkovi blokirani, navigacija mora ići **klikovima unutar SPA-a**
(client-side routing) s ulazne stranice.

Temelj je u `fetcher/src/browser.ts`:

- `warmEntry(entryPath='/football')` — sleti na dopuštenu ulaznu stranicu jednom po procesu
  (hidrira SPA sesiju). Baca `RateLimitedError` ako je i ulaz 403 (znak da je IP još vruć).
- `harvest(navigate, want, settleMs)` — prikači response-listener, pokrene `navigate(page)`
  (npr. klik na utakmicu u listi), pa vrati `Map<path, {status, body}>` za sve `/api/v1`
  odgovore čiji path matcha `want`. Jedna navigacija na match-view okine ~10 poziva
  (`/event/{id}` + `/odds` + `/votes` + `/statistics` + `/lineups` + `/shotmap` …) →
  cijeli enrich payload odjednom.

## ✅ Stanje (2026-06-12): refresh radi

Egress ide kroz **iPhone mobile-phone-proxy** (Tailscale `100.71.146.11:8888`, Telemach
mobilni IP) preko `SOFA_PROXY_SERVER` — `config.ts` + `browser.ts` rutiraju Chrome kroz taj
HTTP proxy. Svjež mobilni IP poništio je IP-eskalaciju; SPA-ovi pozivi prolaze 200.

`refreshViaPiggyback()` (`refresh.ts`) je uvezan: harvesta `/football`, pokupi WC schedule
feed (`events/next/0`, ~217 KB), date-keyed WC fixtures i `/event/{id}` detalje, upserta sve
WC (turnir 16) evente. `npm run refresh` radi, cijeli `hourly-snapshot.sh` prošao end-to-end
(refresh → predict:dc → simulate → history:record → snapshot/publish). `SOFA_PROXY_SERVER`
ožičen u cron (default na Tailscale IP).

**Caveat:** iOS suspendira proxy listener kad app ode u pozadinu / ekran se zaključa →
telefon mora ostati budan/foreground. Za 24/7 cron: Android build (README: hardened) ili
Windows parked-node. Ako proxy spava, refresh upserta 0 i upozori; ostatak pipelinea vrti na
postojećim podacima.

**Još NE radi:** `enrich` + `backfill` koriste direktni `getJson` → 403 (challenge je
per-request, ne pomaže ni mobilni IP). **Onemogućeni u cronu.** Idući korak: migracija na
piggyback po checklistu dolje.

`harvest`/`warmEntry` su u `browser.ts` i prolaze typecheck/testove; enrich orkestracija
(match-view klik, selektori, timing) treba živu kalibraciju.

## Validacijski checklist (kad se IP ohladi)

Pokretati s **drugim egress IP-em** da se ne pali glavni: `SOFA_VIA_IPHONE=1` (mobilni
tether, docs/09) ili pričekati nekoliko sati cooldowna. Mali volumen.

1. `warmEntry()` na `/football` → očekuj 200 (ako 403, IP još vruć — stani).
2. Na ulaznoj stranici lociraj listu utakmica: `a[href*="/football/match/"]`. Ako ih nema,
   probaj livescore (`/football/livescore`) tijekom WC termina (19h/22h/01h po Zagrebu).
3. `harvest(p => p.click(<match link>), /\/event\/\d+/)` → potvrdi da SPA-route okida
   `/event/{id}/...` pozive na 200 i da hvatamo tijela.
4. Ako da: uvezi u `enrich.ts` (jedan match-view klik po utakmici → parsiraj svih 5 payloada
   iz uhvaćenih tijela, postojeći `parse*` već rade), i u `refresh.ts` (events feed iz
   ulazne stranice / kalendara).
5. Ako SPA-route također 403 → piggyback je mrtav; pivot na plaćeni API (api-football).

## Fallback ideje ako piggyback padne

- **Plaćeni API** (api-football.com, ~€15-30/mj): stabilno, ali remap endpointa/ID-eva.
- **Mobilni/rotirajući egress** + niži volumen ako je blok pretežno IP-level.
