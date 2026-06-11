# 14 — Javni deploy (Cloudflare) + satni snapshot pipeline + brand

> Stanje na 2026-06-11. Javna produkcija: **https://nogomet.domovina.ai** — brand **„Lopta je okrugla"**
> (DOMOVINA obitelj). Supabase/Postgres ostaje isključivo lokalni dev; produkcija čita snapshot.

## Arhitektura

```
[doma, rezidencijalni IP]                                  [Cloudflare, account D.O.M.]
fetcher ──> Postgres (56322) ──> npm run snapshot ──KV──> Worker pediludium-web ──> nogomet.domovina.ai
   (refresh/backfill/history)          │
   (predict:dc / simulate)             └──────────────R2──> pediludium-snapshots/snapshots/<ts>.json
                                                            (immutable povijest — calibration!)
```

- **Worker:** `pediludium-web` (OpenNext adapter, `web/wrangler.jsonc`), custom domain preko `routes`.
- **KV namespace `SNAPSHOT`** (`7b0c159c53f14f868fd6504dae5d94ba`), account `7dc7167b7e2e00923bfa7cd697df14e4`:
  - `core` — matches + predictions (svi modeli) + standings + ratings + simulations + teams (~130 KB)
  - `hist:{teamId}` — povijest po reprezentaciji (48 ključeva)
  - `evs:{shard}` — precomputed EventDetail, shardano po `event_id % 64` (64 ključa — NE per-event,
    KV write košta $5/M; vidi `EVENT_SHARDS` u `fetcher/src/export-snapshot.ts` — mora biti
    sinkroniziran s `web/lib/data-snapshot.ts`)
- **R2 bucket `pediludium-snapshots`:** svaki publish arhivira **puni** `snapshot.json` pod
  `snapshots/{generated_at s ':'→'-'}.json`. Format: `{ core, histories, events }` gdje `core`
  sadrži `generated_at`, `matches` (sa scoreovima!), `predictions` (po model_version),
  `simulations`, `standings`, `ratings`. **Ovo je jedina kronološka povijest predikcija** —
  tablica `prediction` u Postgresu se UPSERTA (stari izračuni se pregaze).

## Pipeline skripte (fetcher/)

- `npm run export` → `src/export-snapshot.ts`: svi web queriji dumpani u SQL-u (`json_agg` —
  bigint stiže kao broj, ne string!) → `snapshot/kv-bulk.json` + `snapshot/snapshot.json`.
- `npm run snapshot` = export + `src/publish-snapshot.ts`: **diferencijalni** KV upload
  (diff protiv `snapshot/.published-kv.json`; tipično 1 write = `core`) + R2 arhiva.
- Wrangler OAuth na ovom Macu; `CLOUDFLARE_ACCOUNT_ID` hardkodiran u publish skripti (override env).

## Automatika — launchd

`fetcher/scripts/com.pediludium.snapshot.plist` → instaliran u `~/Library/LaunchAgents/`,
**svaki sat u :05** + RunAtLoad. Tick = `fetcher/scripts/hourly-snapshot.sh`:

| Kada | Što |
|---|---|
| svaki sat | `refresh --full` (rezultati+raspored, headless Chrome `SOFA_HEADLESS=1` — dokazano prolazi) → `predict:dc` → `simulate` → `snapshot` |
| 02/08/14/20 h | + `backfill` (standings + group tagging) |
| 04 h | + `history` & baseline `predict` (noćni bulk, delay 2500–6000 ms po docs/10) |

Log: `~/Library/Logs/pediludium/snapshot.log`. mkdir-lock protiv preklapanja; failani step se
logira i chain nastavlja (objavi se staro-ali-konzistentno). Upravljanje:
`launchctl bootout/bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pediludium.snapshot.plist`.
⚠️ launchd preskače tickove dok Mac spava; Postgres (Docker) mora biti up.

## Web: dva data sourcea + i18n + brand

- `web/lib/data.ts` = facade: `NEXT_PUBLIC_DATA_SOURCE=snapshot` (build-time) bira
  `data-snapshot.ts` (KV preko `getCloudflareContext()`, 60 s in-isolate cache za `core`)
  umjesto `data-supabase.ts` (lokalni dev + Realtime). Deploy: `cd web && npm run deploy`.
- **i18n:** HR default, EN switcher u navu (cookie `lang`). Rječnici `web/lib/i18n.ts`
  (+ `teamName()` alpha2→hrvatski egzonimi, `groupLabel()`, `resultLetter()`), server helper
  `web/lib/lang.ts`. Datumi `fmtDay(iso, lang)`.
- **Brand:** javno ime **„Lopta je okrugla"**; logo `web/public/logo.svg` (izvor:
  `mediakit.domovina.tv/domovina_lopta_logo_square.svg`). **Standalone pravilo:** u UI-u se
  nigdje ne smije vidjeti SofaScore (id-evi, endpointi, domene) — pazi kod novih featurea.
- **Zastave:** `EN`/`SX`/`WA` (Engleska/Škotska/Wales — SofaScore kodovi) → Unicode subdivision
  tag sekvence u `web/lib/format.ts`; `XK` nema emoji.

## KV propagacija

KV edge cache ~60 s + 60 s in-isolate cache u `data-snapshot.ts` → promjena vidljiva ≤ 2 min
nakon publisha. „Podaci: \<ts> UTC" u heroju dolazi iz `core.generated_at`.
