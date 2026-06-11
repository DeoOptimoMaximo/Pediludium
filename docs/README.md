# Pediludium — Handoff & Design Docs

> Realtime tracking i AI predikcije za **FIFA World Cup 2026** (USA / Mexico / Canada),
> s podacima dohvaćenim preko (neslužbenog) SofaScore API-ja.

Ovaj folder je **handoff** sa starog repozitorija (`sports-api-fetcher`, ručno pisan prije
par godina za jedno europsko prvenstvo) na novi, čistiji projekt. Cilj nije 1:1 prijenos
koda nego prijenos **znanja** — kako se dohvaćaju utakmice — uz prelazak na industry best
practices.

## Kontekst i rok

- **Danas:** 2026-06-07
- **Start SP-a:** ~2026-06-11 (za 4 dana) → **MVP-first**: prvo pouzdan ingest, tek onda predikcije.
- **Trajanje:** ~1 mjesec, tj. fetcher i predictor moraju raditi neprekidno.

## Sadržaj

| Dok | Tema |
|-----|------|
| [01-legacy-baseline.md](./01-legacy-baseline.md) | Kako je stari repo radio (baseline overview) |
| [02-sofascore-api-reference.md](./02-sofascore-api-reference.md) | Endpointi, parametri, oblik podataka |
| [03-fetching-strategy.md](./03-fetching-strategy.md) | Blokiranje, residential IP, random delay, retry, cache |
| [04-target-architecture.md](./04-target-architecture.md) | Predložena arhitektura novog sustava |
| [05-roadmap.md](./05-roadmap.md) | Plan po danima do starta turnira |
| [06-infra-supabase-coolify.md](./06-infra-supabase-coolify.md) | Supabase lokalni Docker ↔ cloud Coolify konvencija |
| [07-day1-probe-results.md](./07-day1-probe-results.md) | Dan-1 rezultati: season id, 48 timova, TLS-fingerprint nalaz |
| [08-prediction-roadmap.md](./08-prediction-roadmap.md) | Baseline → napredni prediktor (TODO/TBD) |
| [09-egress-and-rate-limits.md](./09-egress-and-rate-limits.md) | IP ban + `--via-iphone` mobilni IP bypass |
| [10-polite-fetching-playbook.md](./10-polite-fetching-playbook.md) | Nenagresivna obrada velikog request queue-a |
| [11-android-app-investigation.md](./11-android-app-investigation.md) | Zašto app prolazi a browser ne (OkHttp potpis) |
| [12-realtime-notes.md](./12-realtime-notes.md) | Realtime end-to-end + REPLICA IDENTITY FULL kvaka |
| [13-simulation-model.md](./13-simulation-model.md) | Dixon-Coles + Monte-Carlo simulacija turnira (advance/win-cup odds) |
| [14-public-deploy-and-snapshots.md](./14-public-deploy-and-snapshots.md) | Javni Cloudflare deploy (nogomet.domovina.ai), satni snapshot pipeline, R2 povijest, brand „Lopta je okrugla" + i18n |

## Tech stack (dogovoreno)

- **Baza + backend:** Supabase (PostgreSQL + Auth + auto REST/GraphQL + Realtime), lokalno u **Dockeru**.
- **Web (MVP, prvo):** Next.js / React — referentna implementacija.
- **Mobile (kasnije):** Flutter, **port iz weba** — u planu, ne implementira se sada.
- **Fetcher:** TypeScript + zod + politeness layer; radi s residential IP-a, piše u Supabase.
- Stari repo nije imao DB (samo CSV/JSON); Firestore iz sjećanja bio je drugi projekt → DB je greenfield.

## TL;DR ključni nalazi

1. **SofaScore nema službeni API.** Koristi se `https://api.sofascore.com/api/v1/...`.
   Endpointi su stabilni godinama, ali bez ikakvih garancija — tretiraj kao "može puknuti".
2. **Blokiranje je po tipu IP-a, ne po zemlji.** Datacenter/cloud IP-evi (AWS, GCP, Hetzner…)
   se blokiraju (403/Cloudflare). **Hrvatske residential IP adrese (kućni internet) prolaze.**
   → Posljedica za arhitekturu: **fetcher mora raditi s residential IP-a**, a ne iz clouda.
3. **World Cup 2026** = SofaScore `unique-tournament` **id `16`** ("World Championship",
   kategorija World/international `1468`). Season id za 2026 treba dohvatiti
   (`/unique-tournament/16/seasons`) — vidi dok 02.
4. **Smart delay je obavezan** i kad prolaziš: randomizirani razmak + jitter + retry s
   backoffom da izgledaš kao čovjek i ne triggeraš rate-limit.
