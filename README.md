# Pediludium

**Data layer & single source of truth** za realtime praćenje i AI predikcije
**FIFA World Cupa 2026** (USA / Mexico / Canada), s podacima iz (neslužbenog) SofaScore API-ja.

Cilj: jedan od **najboljih open-source analitičkih alata za praćenje nogometa**, lansiran na
WC2026. MVP scope = isključivo reprezentacije/utakmice World Cupa 2026; shema je generička i
proširiva (prati SofaScore), WC2026 je samo scope filter.

**Stack:** Supabase/Postgres (lokalno u Dockeru) · Next.js web (MVP) · Flutter mobile (port
iz weba, kasnije, ne sada) · TypeScript fetcher (pravi Chrome transport).

## 🗂️ Struktura (MVP monorepo)

> Napomena: docs/04 predviđa app u **zasebnom repou**. Za brzi MVP sve je zasad ovdje kao
> **monorepo** (lakše za autonoman build/test); web se po potrebi kasnije izdvaja čist za Flutter port.

| Folder | Uloga |
|--------|-------|
| [`fetcher/`](./fetcher) | TS ingest: politeness + **browser transport** (pravi Chrome), backfill, baseline predikcije. Puni Supabase. |
| [`supabase/`](./supabase) | Lokalni Supabase config + **shema** (migracije). Custom portovi **563xx**. |
| [`web/`](./web) | **Next.js** privatna vizualizacija (Overview/Fixtures/Groups/Predictions/Match). Port **3100**. |
| [`docs/`](./docs) | Dizajn, API reference, strategija, roadmap, rezultati, prediction & infra konvencije. |

## 🚀 Kako pokrenuti (lokalno)

```bash
# 1) Baza — lokalni Supabase u Dockeru (custom portovi, koegzistira s drugim stackom)
supabase start                       # API :56321, DB :56322, Studio :56323

# 2) Fetcher (kod kuće, residential IP; pravi Chrome) — napuni bazu
cd fetcher && npm install
npm run probe         # verifikacija + season id
npm run backfill      # 104 utakmice + 48 reprezentacija + standings
npm run predict       # Elo + Poisson baseline predikcije

# 3) Web — privatna vizualizacija
cd ../web && npm install && npm run dev    # http://localhost:3100
```

> ⚠️ **Pristup SofaScore-u:** blok je po **TLS fingerprintu**, ne IP-u → fetcher dohvaća kroz
> **pravi Chrome** (Playwright `channel:'chrome'`), ne curl/fetch. Vidi
> [docs/07](./docs/07-day1-probe-results.md).

## 📚 Dokumentacija

Sve je u [`docs/`](./docs/README.md):

1. [Legacy baseline](./docs/01-legacy-baseline.md) — kako je radio stari `sports-api-fetcher`
2. [SofaScore API reference](./docs/02-sofascore-api-reference.md) — endpointi, parametri, shape
3. [Fetching strategy](./docs/03-fetching-strategy.md) — blokiranje, residential IP, delay, retry
4. [Target architecture](./docs/04-target-architecture.md) — dijagrami sustava, shema baze
5. [Roadmap](./docs/05-roadmap.md) — plan po danima do starta turnira
6. [Infra: Supabase/Coolify](./docs/06-infra-supabase-coolify.md) — lokalni Docker ↔ cloud Coolify konvencija
7. [Dan-1 probe rezultati](./docs/07-day1-probe-results.md) — season id, 48 timova, **TLS-fingerprint nalaz**
8. [Prediction roadmap](./docs/08-prediction-roadmap.md) — baseline → napredni modeli (TODO/TBD)

## Ključna pravila (pročitaj prije koda)

- **Single source of truth:** SofaScore se dohvaća na **jednom mjestu** (fetcher) → puni bazu.
  Sve ostalo čita iz baze.
- **Residential IP:** fetcher radi s hrvatskog kućnog interneta; cloud/datacenter IP-evi su blokirani.
- **Smart delay:** randomizirani razmak + jitter + retry/backoff na svakom requestu.
- **Raw + parsed:** uvijek spremi i sirovi JSON i normalizirani zapis.

> ⚠️ Neslužbeni API, bez ToS dozvole. Niski volumen, bez paralelizma, osobna/edukacijska upotreba.
