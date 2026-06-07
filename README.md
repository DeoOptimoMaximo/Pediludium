# Pediludium

**Data layer & single source of truth** za realtime praćenje i AI predikcije
**FIFA World Cupa 2026** (USA / Mexico / Canada), s podacima iz (neslužbenog) SofaScore API-ja.

Ovaj repozitorij dokumentira **kako se dohvaćaju stvarni podaci** i (kasnije) sadrži
**fetcher/ingest** koji puni bazu. Aplikacija (**Supabase/PostgreSQL** + **Next.js** web,
kasnije **Flutter** mobile) živi u **zasebnom repozitoriju** i čita **samo iz naše baze** —
nikad direktno SofaScore.

**Stack:** Supabase/Postgres (lokalno u Dockeru) · Next.js web (MVP) · Flutter mobile (port
iz weba, kasnije, ne sada) · TypeScript fetcher.

## 📚 Dokumentacija

Sve je u [`docs/`](./docs/README.md):

1. [Legacy baseline](./docs/01-legacy-baseline.md) — kako je radio stari `sports-api-fetcher`
2. [SofaScore API reference](./docs/02-sofascore-api-reference.md) — endpointi, parametri, shape
3. [Fetching strategy](./docs/03-fetching-strategy.md) — blokiranje, residential IP, delay, retry
4. [Target architecture](./docs/04-target-architecture.md) — dijagrami sustava, shema baze
5. [Roadmap](./docs/05-roadmap.md) — plan po danima do starta turnira

## Ključna pravila (pročitaj prije koda)

- **Single source of truth:** SofaScore se dohvaća na **jednom mjestu** (fetcher) → puni bazu.
  Sve ostalo čita iz baze.
- **Residential IP:** fetcher radi s hrvatskog kućnog interneta; cloud/datacenter IP-evi su blokirani.
- **Smart delay:** randomizirani razmak + jitter + retry/backoff na svakom requestu.
- **Raw + parsed:** uvijek spremi i sirovi JSON i normalizirani zapis.

> ⚠️ Neslužbeni API, bez ToS dozvole. Niski volumen, bez paralelizma, osobna/edukacijska upotreba.
