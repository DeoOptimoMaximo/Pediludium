# 12 — Realtime end-to-end (Supabase → frontend, bez reloada)

Kako otvorena stranica u webu **instant** vidi promjenu čim fetcher upiše u bazu — i jedna
kvaka koju treba znati.

## Lanac

```
fetcher upsert (pg) → Postgres WAL → Supabase Realtime → web klijent (subscribe) → router.refresh()
```

1. **Publikacija:** tablice moraju biti u `supabase_realtime` publikaciji. Dodano:
   `match`, `prediction`, `standing`, `team_match` (migracije 2026-06-07/08).
2. **Klijentski sloj:** `web/app/components/RealtimeRefresh.tsx` (client component) se
   `subscribe`-a na `postgres_changes` (opcionalno filtrirano, npr. `team_id=eq.4715`) i na svaku
   promjenu zove **`router.refresh()`** → Next.js re-fetcha server-komponentu iz baze i osvježi UI
   **u mjestu, bez full reloada**. Drop-in: stavljen na overview/fixtures/groups/predictions/match/team/event.
3. **Server-komponente** su `force-dynamic` (svjež DB read na svaki render), pa `router.refresh()`
   uvijek povuče zadnje stanje.

## ⚠️ Kvaka: filtrirani DELETE event ne stiže bez REPLICA IDENTITY FULL

Postgres po defaultu u WAL za DELETE stavlja samo **PK** "starog" reda. Ako se realtime subscription
**filtrira po ne-PK koloni** (npr. `team_id=eq.X`), DELETE event se **ne matcha** (jer `team_id`
nije u old-record payloadu) → UI se ne osvježi na brisanje. INSERT/UPDATE rade (nova vrijednost
nosi kolonu).

**Fix:** `alter table public.<t> replica identity full;` na tablicama koje imaju **filtrirane**
subscriptione (`match`, `team_match`). Tad old-record nosi sve kolone → filtrirani DELETE prolazi.
(Migracija `20260608091000_realtime_replica_identity.sql`.)

## Dokazano (2026-06-08)
Otvorena Hrvatska stranica: ručni `INSERT/UPDATE/DELETE` u `team_match` → UI se mijenjao instant
(matches 126↔127, golovi, recent form), bez reloada. Isto s pravim fetchom (Hrvatska 2-1 Slovenija
kroz mobilni IP → realtime → stranica).

## Auth/RLS
Realtime `postgres_changes` poštuje **RLS** — anon ima `select ... using (true)` na tim tablicama,
pa prima evente. Fetcher piše direktno (`pg`, bypassa RLS).
