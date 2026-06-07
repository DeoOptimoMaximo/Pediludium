# Pediludium fetcher

SofaScore ingest for the **World Cup 2026** data layer (docs in `../docs`).
Single choke point to the (unofficial) SofaScore API — **must run from a residential IP**
(cloud/datacenter IPs are blocked; see `../docs/03-fetching-strategy.md`).

- Runtime: **Node ≥ 22.18** (runs `.ts` directly via native type-stripping — no build step).
- Deps: `zod` only. Native `fetch` for HTTP.
- Politeness: random delay + jitter, UA rotation, concurrency 1, retry/backoff, circuit breaker.

## Setup

```bash
npm install
cp .env.example .env   # optional — defaults are sane
```

## Day-1 probe

Verifies endpoints, resolves the **2026 season id**, and lists participating teams.
Raw samples are dumped to `.probe-samples/` (gitignored).

```bash
npm run probe
```

## Other scripts

```bash
npm test          # vitest (politeness layer)
npm run typecheck # tsc --noEmit
npm run format    # prettier
```

## Layout

| File | Role |
|------|------|
| `src/config.ts` | zod-parsed env config + WC constants |
| `src/politeness.ts` | delay/jitter/retry/backoff/circuit-breaker + serial queue |
| `src/http.ts` | native-fetch GET → zod-validated `{ data, raw }` (the only place that calls SofaScore) |
| `src/schemas.ts` | zod shapes for seasons / events |
| `src/probe.ts` | Day-1 orchestrator |

## Secrets

`.env` is gitignored. `FIRECRAWL_API_KEY` (if present) is for enrichment from *other* public
sources — **not** for SofaScore, which must stay on native fetch from a residential IP.
