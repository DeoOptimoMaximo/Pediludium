# 06 — Infra konvencija: Supabase (lokalni Docker ↔ cloud Coolify)

> **Vrijedi za Dan 3+ (zaseban app repo).** Kad krenemo na bazu, **prati identičnu
> konvenciju** kao `domovina-api` (`/Users/ms/git/domovinatv/domovina-api`) — to je
> referentni, dokazani setup za self-hosted Supabase lokalno u Dockeru i u cloudu preko
> **Coolify**-ja. Ovaj dokument sažima konvenciju; izvor istine su skripte i docs u tom repou.

## Princip: dva orkestratora, ista shema

| | **Lokal** | **Prod** |
|---|---|---|
| Orkestrator | Supabase **CLI** (`supabase start`, bundlani compose) | **Coolify** (Supabase one-click service, self-host) |
| Compose | generira CLI | živi u Coolifyju (`/data/coolify/services/<uuid>/`), **ne u gitu** |
| Verzije | `supabase` binary (brew) | image tagovi **pinani** u Coolify compose-u |
| Ingress | Kong direktno na lokalni port | Cloudflare Tunnel → Traefik → Kong |
| Storage | CLI interni | MinIO |
| Gateway | `supabase/kong` | `kong/kong` |

**Jedini izvor istine i identičan na oba mjesta:** `supabase/migrations/` i
`supabase/functions/`. Divergira **samo** orkestracija i verzije runtime slika — cilj je
**funkcionalna parnost**, ne byte-identičnost. Lokal smije biti **ispred** prod-a (canary za
sljedeći prod bump), ali app kod nikad ne smije ovisiti o feature-u kojeg prod još nema.

## Što kopiramo iz domovina-api konvencije

1. **Repo = infra-as-code + dokumentacija**, NE Supabase source. Sadrži `supabase/`
   (migracije, functions, RLS, seed), `scripts/`, `cloudflared/`, `.env.example` (bez secreta).
2. **Schema-as-code:** sve migracije u `supabase/migrations/` kao **idempotentan SQL**
   (`create if not exists`, `create or replace function`, `drop … if exists` pa create).
   Filename: `YYYYMMDDHHMMSS_<area>_<what>.sql` (sortable). Tracking u
   `supabase_migrations.schema_migrations` (CLI-kompatibilno). App repo (Next.js, kasnije
   Flutter) **samo konzumira** preko SDK-a — nikad ne definira shemu.
3. **Secrets workflow (zero leakage):**
   - `.coolify-defaults.env` (gitignored) = Coolify auto-generirani baseline (struktura).
   - `.local-secrets.env` (iz `.example`) = pravi secreti lokalno.
   - `scripts/build-coolify-env.sh` = generira fresh secrets + override config + merge slojeva
     (`defaults → overrides+fresh secrets → local secrets`), **kopira finalni env u clipboard**,
     na stdout samo **maskirani preview** (`Jb6L****k9Mz`). Paste u Coolify → Save → Deploy.
   - **Rotacija** = pokreni skriptu ponovno, paste, redeploy.
   - Niti jedan secret ne ide u repo ni u chat. (Isti princip kao Firecrawl ključ ovdje:
     `.env`, gitignored, maskiran u outputu.)
4. **Migracije na prod = SSH + `docker exec psql`** (`db-migrate.sh`, `db-status.sh`,
   `db-dump.sh`) — bez izlaganja DB porta javno; auto-detect `supabase-db-*` containera.
   `db-migrate.sh` radi `pg_dump` backup pa apply u transakciji.
5. **Verzije pinane; Coolify NE auto-update-a.** "Pull Latest & Restart" uz pinane tagove
   NIJE upgrade. Pravi upgrade = ručno bumpaj image tagove u Coolify compose editoru →
   Redeploy. Postgres major = `pg_dump`/restore, nikad in-place. Bumpaj po grupama
   (stateless → app-facing → Postgres zadnji), uvijek lokal-test + backup prvo.
6. **Ingress:** javni promet ide Cloudflare Edge → **Cloudflare Tunnel** → Traefik (Coolify
   labels po Host headeru) → Kong. DB port se nikad ne izlaže.

## Što je drukčije za Pediludium (vs domovina-api)

- domovina-api je **identity/SSO hub** za više proizvoda (GoTrue zajednički user, Kong gateway).
  Pediludium je **standalone** analitički alat — Auth je sekundaran (MVP može i bez login-a).
- Pediludiumu je ključan **Realtime** (live score push) — isti Supabase Realtime, bez vlastitog WS.
- **Fetcher (ovaj repo) NIJE u Coolifyju** — radi kod kuće (residential, vidi [03](./03-fetching-strategy.md))
  i piše u Supabase **service-role** ključem (preko javnog Kong endpointa ili tunela). U Coolify
  ide samo app stack (Supabase + Next.js), nikad fetcher.

## Reference (domovina-api)

- `README.md` — secrets workflow, hosting topologija, DB migrations workflow.
- `docs/supabase-version-management.md` — lokal↔prod verzije, siguran upgrade, staging.
- `scripts/build-coolify-env.sh`, `scripts/db-migrate.sh`, `scripts/supabase-versions.sh`.
- `supabase/config.toml`, `supabase/migrations/`.
