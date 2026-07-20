# 22 — Operativni runbook

> Što se vrti, što može puknuti, kako to prepoznaš i što tada radiš.
> Napisano 2026-07-20 nakon izvršenja [`docs/21`](21-post-wc-roadmap.md) §2 i §2E.
> `docs/21` objašnjava **zašto** je sve ovako; ovaj dokument je **što napraviti u 3 ujutro**.

---

## 1. Što se vrti

| Job | Raspored | Skripta | Log |
|-----|----------|---------|-----|
| `com.pediludium.snapshot` | svaki sat u :05 | `fetcher/scripts/hourly-snapshot.sh` | `~/Library/Logs/pediludium/snapshot.log` |
| `com.pediludium.matchsync` | svakih 15 min | `fetcher/scripts/match-sync.sh` | `~/Library/Logs/pediludium/matchsync.log` |
| `com.pediludium.health` | svakih 30 min | `fetcher/scripts/health-check.sh` | `~/Library/Logs/pediludium/health.log` |
| `pediludium-watchdog` | svaka 3 h (Cloudflare) | `watchdog/src/index.ts` | `cd watchdog && npx wrangler tail` |

Plistovi su u `fetcher/scripts/` (verzionirani). Instalacija:

```bash
cp fetcher/scripts/com.pediludium.*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pediludium.health.plist
launchctl list | grep pediludium          # provjera
```

> **Zamka:** launchd preskače tickove dok Mac spava (na buđenju ih spoji u jedan). To je uredu i
> očekivano — zato prag watchdoga i jest 12 h, a ne 1 h.

### 1.1 Zamrznuta (arhivirana) sezona — trenutno stanje

Od `docs/21` §3B sezona sa svih X/X odigranih utakmica **ne generira nikakav posao**. Jobovi se
NE gase i ne treba ih ništa naknadno uključivati — samo nemaju što raditi. Zdrav tick sada
izgleda ovako i to **nije kvar**:

```
[sync-gate] SKIP — sezona arhivirana (104/104 odigrano), nema više posla
[refresh-gate] SKIP — sezona arhivirana (104/104 odigrano)
[gate] SKIP — no match change since last publish (model drift only)
```

Tri gatea, tri razine: `should-sync` (Firecrawl rezultati), `should-refresh` (hourly
`refresh --full`) i `should-publish` (KV). Zamrznuti tick traje ~1 s i ne diže Chrome.

**Heartbeat se i dalje piše na svakom ticku, uključujući zamrznuti** — zato `npm run health`
ostaje zelen (`ingest tick svjež`). Da je liveness vezan uz stvarni dohvat, arhivirana sezona
izgledala bi identično mrtvom ingestu.

**Odmrzavanje je automatsko.** Čim u bazi postoji sezona s neodigranim utakmicama, oba gatea se
otvore sama. `should-refresh` je namjerno **fail-open**: ako baza zakaže, refresh se izvodi, jer
je „tiho zamrznuta živa sezona" gori ishod od jednog suvišnog dohvata.

> **Zamka za novo natjecanje:** freeze pravilo je `total > 0 && played >= total`. Prazna sezona
> (0/0) se namjerno **ne** smatra arhiviranom — inače bi se tek onboardano natjecanje zamrznulo
> prije prvog ingesta i nikad ne bi krenulo.

---

## 2. Notifikacije

Kanal je **ntfy.sh**, besplatno i bez registracije. Ime topica je **dijeljena tajna** (tko ga zna,
može čitati i slati) pa živi isključivo u `fetcher/.env` kao `HEALTH_NTFY_TOPIC` — **nikad u repo**,
po konvenciji iz [`docs/06`](06-infra-supabase-coolify.md) i memorije `secrets-zero-leakage`.

Pretplata na telefonu:

1. instaliraj **ntfy** (App Store / Google Play / F-Droid)
2. **+** → *Topic name* = vrijednost `HEALTH_NTFY_TOPIC` iz `fetcher/.env`
3. server ostavi `ntfy.sh` (ne diraj „Use another server")

Isti topic koristi i Cloudflare watchdog — tamo je postavljen kao wrangler secret:

```bash
cd watchdog && npx wrangler secret put NTFY_TOPIC     # ako ga mijenjaš, promijeni na OBA mjesta
```

Provjera da kanal radi:

```bash
cd fetcher && npm run alert:test
```

**Cooldown je 6 h po tipu alarma** (`HEALTH_ALERT_COOLDOWN_H`), da pad baze ne pošalje 48 poruka
dnevno. Dobiješ jednu, pa sljedeću za 6 h ako i dalje traje. Oporavak briše cooldown, pa te idući
kvar odmah probudi.

---

## 3. Alarmi — što znače i što napraviti

### 🔴 `db` — „Supabase/Postgres nedostupan"

Najčešći kvar; 18 puta između 18.6. i 18.7.2026.

**Prvo ne radi ništa** — `health-check.sh` sam pokreće `supabase-guard.sh` i u pravilu vrati bazu
za ~5 s. Ovaj alarm stiže **samo ako je oporavak već pao**. Tada ručno:

```bash
open -a Docker
cd /Users/ms/git/DeoOptimoMaximo/Pediludium && supabase start
cd fetcher && npm run health          # potvrda
```

Ako se Docker ne diže: Docker Desktop → Troubleshoot → Restart. Nakon povratka baze **ništa ne
moraš nadoknađivati ručno** — catch-up gate sam pokupi sve neodigrane utakmice do 14 dana unatrag.

### 🔴 `ingest` — „zadnji uspješan ingest tick prije N h"

Baza radi, ali `should-sync` se ne izvršava → launchd job ne radi.

```bash
launchctl list | grep pediludium                    # vidi li se job i koji mu je exit kod?
tail -50 ~/Library/Logs/pediludium/matchsync.log
launchctl kickstart -k gui/$(id -u)/com.pediludium.matchsync   # prisilni restart
```

### 🔴 `stranded` — „N utakmica odigrana a bez rezultata"

Utakmica je počela prije 3+ h a još nije `finished`. Obično znači da joj je slug mrtav ili je
knockout slot nerazriješen.

```bash
cd fetcher
psql "$SUPABASE_DB_URL" -c "select match_id, attempts, last_status, next_check_at from match_sync_attempt"
env REFRESH_FC_SINCE_H=48 npm run refresh:fc        # prisilni široki sweep, ignorira backoff
env RESOLVE_KO_SEEDS=1 npm run resolve:ko           # ako je knockout slot placeholder
```

⚠ **Ako je knockout:** `resolve:ko` NE zna razriješiti runde unatrag (docs/21 §1-epilog). Workaround
je scrape timske stranice finalista → `{slug}/{customId}#id:{matchId}` → ručni SQL update slotova
**i** `raw.slug`/`raw.customId`. **Nakon svakog resolve-a provjeri da pobjednik nije obrnut** —
slug redoslijed ≠ home/away (memorija `knockout-resolve-and-bracket`).

### 🔴 `publish` — „snapshot nije objavljen N h, a ima neobrađenih utakmica"

Pipeline računa ali ne objavljuje. Gotovo uvijek KV dnevni limit (1000 upisa) ili istekli wrangler
OAuth.

```bash
cd fetcher && npx wrangler whoami
FORCE_PUBLISH=1 npm run snapshot
```

### 🔴 `watchdog` — „kućni pipeline šuti"

Stiže s Clouda, ne s Maca. Znači da se **Mac nije javio 12+ h** — ugašen, uspavan, ili je launchd
stao. **Provjeri stroj, ne aplikaciju.** Nakon buđenja Maca sve se samo vraća; potvrda:

```bash
cd fetcher && npm run health
```

### ⚠ `proxy` — „mobilni proxy nedostupan"

**Očekivano i bezopasno.** iPhone piggyback je mrtav tjednima; rezultati idu Firecrawl putem.
Namjerno je `warn`, nikad `red`, da ne trenira ignoriranje kanala.

---

## 4. Docker — poznata stanja na ovom Macu

- **Dockerov vlastiti „start at login" je POKVAREN.** `settings-store.json` trajno drži
  `AutoStart=False` uz `AutoStartError: "operation is not permitted when registering app service"` —
  macOS odbija registraciju login itema. Ne trošiti vrijeme na taj toggle.
- **Zaobilaženje:** Docker je dodan ručno u *System Settings → General → Login Items* (2026-07-20).
  To pokriva **reboote**.
- **Ne pokriva dark wake.** Većina ispada (8–20 h, noću) bila je s upaljenim Macom i nedignutim
  Docker VM-om — tu radi samo `supabase-guard.sh`.
- **Resource Saver je i dalje UKLJUČEN** (`UseResourceSaver=true`, timeout 300 s) i vjerojatno
  pridonosi parkiranju VM-a. Ako se ispadi nastave: Docker Desktop → Settings → Resources → isključi.

---

## 5. Forenzika logova

Logovi se rotiraju na 5 MB, čuvaju se 3 generacije (`fetcher/scripts/logrotate.sh`, zove se na
početku svakog ticka). Starije generacije su `.1.gz`, `.2.gz`…

Svaki tick ostavlja **jedan datirani redak** s ishodom, pa je ovo dovoljno:

```bash
grep 'match-sync SKIP\|match-sync PROCEED' ~/Library/Logs/pediludium/matchsync.log | tail -20
zgrep 'ECONNREFUSED' ~/Library/Logs/pediludium/matchsync.log.1.gz | wc -l
```

> Prije 2026-07-20 SKIP linije **nisu imale datum**, pa rekonstrukcija ispada iz starih arhiva
> traži skriptu koja nosi zadnji datirani redak naprijed. Ako kopaš po `.gz` arhivi starijoj od
> tog datuma — to je razlog.

---

## 6. Trošak u mirovanju

Mjereno nakon §3B (2026-07-20): zamrznuti tick = **0 Firecrawl poziva, 0 KV upisa, bez Chromea**.
Između natjecanja, sa zamrznutom sezonom: **≈ 0 Firecrawl kredita** (gate skipa), **≈ 0 KV upisa**
(publish gate + health piše samo na promjenu statusa). Watchdog troši zanemarivo (8 cron poziva
dnevno, upis u KV samo na prijelaz stanja). Jedini fiksni trošak je Mac koji vrti launchd.
