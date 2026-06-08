# 10 — Polite fetching playbook (nenagresivna obrada velikog queue-a)

Kako obraditi **puno HTTP zahtjeva polako i pristojno** da ne triggeraš rate-limit / IP ban.
Ovo je obavezno štivo prije bilo kakvog bulk fetcha (backfill, history, re-sync). Kontekst zašto:
[03](./03-fetching-strategy.md) (strategija) i [09](./09-egress-and-rate-limits.md) (kako smo se zabanali).

## TL;DR — zlatna pravila

1. **Concurrency = 1.** Nikad paralelno, nikad burst. Jedan serijski red.
2. **Delay + jitter prije SVAKOG zahtjeva.** Default `1500–4000ms`. Za bulk **veći**, ne manji.
3. **Nikad ne spuštaj delay da ubrzaš bulk.** (Točno to nas je zabanalo — vidi [09](./09-egress-and-rate-limits.md).)
4. **Retry s eksponencijalnim backoffom**, honoriraj `429/Retry-After`.
5. **Circuit breaker:** nakon N uzastopnih 403/429 → stani 15 min.
6. **Velike pullove radi preko noći** s velikim delayom, ne danju zbijeno.
7. **Ne traži isto dvaput** — honoriraj `ETag`/`304`, preskoči nepromijenjeno.
8. **Dnevni budžet** zahtjeva; pauza svakih N zahtjeva.
9. Kad ipak dobiješ 403-sve: **prebaci egress** (`--via-iphone`, [09](./09-egress-and-rate-limits.md)) ili čekaj sat+.

## Kako je to već ugrađeno (`src/politeness.ts`)

`PoliteClient` daje jedan **globalni serijski red** kroz koji prolazi svaki zahtjev:

- `sleep(jitter(min,max))` prije svakog poziva — ljudski razmak.
- serijalizacija preko promise-chaina → **concurrency 1** (nema bursta ni kad pošalješ 1000 zahtjeva).
- retry s `backoff = jitter(2s,5s) * 2^attempt` (+ honor `Retry-After`).
- **circuit breaker**: `circuitThreshold` uzastopnih 403/429 → otvori na `circuitCooldownMs`.
- UA rotacija + browser TLS (Chrome) → prolazi fingerprint sloj.

Sve skripte (`probe/backfill/history/predict/refresh/scheduler`) idu kroz isti red, pa je tempo
kontroliran na jednom mjestu — **env varijablama**, bez diranja koda.

## Recepti po veličini queue-a

| Queue | Delay (min–max) | Strategija | Primjer |
|-------|-----------------|------------|---------|
| Mali (<50) | `1500–4000` (default) | samo pusti | `npm run backfill` |
| Srednji (50–300) | `2500–6000` | pauza svakih ~30, ne re-runaj | `SOFA_DELAY_MIN_MS=2500 SOFA_DELAY_MAX_MS=6000 npm run history` |
| Velik (300–2000+) | `4000–10000` | **preko noći**, batch + duge pauze, dnevni budžet | vidi "noćni bulk" niže |
| Banan / 403-sve | — | **`--via-iphone`** ili čekaj sat+ | `SOFA_VIA_IPHONE=1 npm run backfill` |

### Env varijable za tempo

```bash
SOFA_DELAY_MIN_MS=4000        # donja granica razmaka
SOFA_DELAY_MAX_MS=10000       # gornja (base+jitter)
SOFA_MAX_RETRIES=4
SOFA_BACKOFF_MIN_MS=3000
SOFA_BACKOFF_MAX_MS=8000
SOFA_CIRCUIT_THRESHOLD=3      # stani brže kod problema
SOFA_CIRCUIT_COOLDOWN_MS=1800000   # 30 min
SOFA_VIA_IPHONE=1             # egress kroz mobilni IP ako je glavni IP banan
```

### Noćni bulk (preporuka za stotine+ zahtjeva)

```bash
# veliki delay, mobilni IP, headless, preko noći; testiraj prvo na jednom timu
SOFA_DELAY_MIN_MS=5000 SOFA_DELAY_MAX_MS=12000 SOFA_HEADLESS=1 \
  npm run history -- --team=4715        # 1 tim = provjera

# pa puni run (≈48 timova × ~5 stranica × ~8s ≈ 30+ min — to je OK, namjerno sporo)
SOFA_DELAY_MIN_MS=5000 SOFA_DELAY_MAX_MS=12000 SOFA_HEADLESS=1 \
  nohup npm run history > history.log 2>&1 &
```

## Procjena tempa (računica budžeta)

Ako želiš **R zahtjeva/min** ciljano: `delay ≈ 60000/R` ± jitter.
- 10 req/min → ~6s delay (umjereno).
- 4 req/min → ~15s delay (vrlo pristojno, za rizične/velike runove).
Za queue od `N` zahtjeva pri delayu `d`: trajanje ≈ `N·d`. Npr. 240 × 8s ≈ **32 min** — prihvatljivo
za jednokratni backfill; **ne** pokušavaj to "ubrzati".

## Dodatne tehnike (TODO u kodu, preporučeno)

- **Pauza svakih N**: nakon svakih ~30 zahtjeva ubaci `sleep(30–90s)` (ljudska stanka).
- **Shuffle redoslijeda** (npr. timova) da izbjegneš pravilan, enumeracijski uzorak.
- **ETag/Conditional GET**: spremi `etag` po URL-u, šalji `If-None-Match` → `304` je ~besplatan.
- **Idempotentni skip**: ne re-fetchaj raspored koji se nije promijenio (samo live/skoro).
- **Globalni token-bucket** preko svih skripti + **dnevni budžet** (hard cap N/dan).
- **Logiraj** svaki fetch (url, status, trajanje) — dokaz tempa i lakši debug.

## Checklist prije velikog runa

- [ ] Delay **povećan** (ne smanjen) za bulk?
- [ ] Testirano na **jednom** entitetu (`--team=ID`) prije punog runa?
- [ ] `SOFA_HEADLESS=1`, `nohup`, preko noći ako je velik?
- [ ] Egress plan ako se zabanam (`SOFA_VIA_IPHONE=1`)?
- [ ] Ne re-runam nešto što već imam (idempotentno + ETag)?
- [ ] Circuit breaker uključen (jest, default)?
