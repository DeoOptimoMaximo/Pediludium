# 09 — Egress, IP ban i `--via-iphone` (mobile IP)

Kako smo se zabanali i kako fetcher ostaje funkcionalan kad se to dogodi.

## Što se dogodilo (2026-06-08)

Nakon ~290 zahtjeva u danu (probe + 3× backfill + history svih 48 + predict + ponovljeni
testovi), uz **prepolovljen delay** (700–1800ms umjesto 1500–4000) za history burst, SofaScore
je **IP-banao naš statički IP** (`89.201.137.96`, Optinet/Telemach) — **403 na sve, i u pravom
browseru**. Detalji uzroka: [07](./07-day1-probe-results.md), memorija `sofascore-access-tls-fingerprint`.

Dva sloja blokade (oba moraju biti zadovoljena za 200):
1. **TLS/HTTP fingerprint** — mora izgledati kao browser (zato fetcher koristi pravi Chrome).
2. **IP reputacija** — statički IP se banao zbog volumena/tempa.

## Rješenje: egress kroz mobilni IP (`--via-iphone`)

Mobilni podatkovni IP (Telemach mobile, npr. `86.33.83.51`, AS205714) je **drugačiji i rotira**
— nije pod banom. iPhone kao **Personal Hotspot preko USB-a** daje Macu interface `en1` s IP-em
`172.20.10.x` (Apple uvijek dodjeljuje 172.20.10.2–14, gateway .1). Bindanjem socketa na tu IP-u
promet izlazi kroz mobilni IP **bez diranja default route-a** (Ethernet ostaje za sve ostalo).

Konvencija preuzeta iz `domovina-api/fetch.domovina.tv/run_pipeline.sh` (`--via-iphone` →
`yt-dlp --source-address 172.20.10.x`). Kod nas fetcher koristi **Chrome**, koji ne može sam
bindati source IP, pa:

- **`src/source-proxy.ts`** — sitni in-process **HTTP CONNECT proxy** čiji su upstream socketi
  vezani na `localAddress = 172.20.10.x`. Auto-detekcija tether IP-a (`detectIphoneSource`).
- **`src/browser.ts`** — ako je egress postavljen, Playwright Chrome se diže s
  `proxy: { server: 'http://127.0.0.1:<port>' }` → sav Chrome HTTPS izlazi kroz mobilni IP,
  a Chrome TLS fingerprint ostaje (prolazi i sloj #1).

### Korištenje

```bash
# auto-detekcija iPhone USB tethera (172.20.10.x):
SOFA_VIA_IPHONE=1 npm run probe
SOFA_VIA_IPHONE=1 SOFA_HEADLESS=1 npm run backfill
SOFA_VIA_IPHONE=1 npm run history -- --team=4715

# ili eksplicitno bilo koja lokalna izvorna IP:
SOFA_SOURCE_ADDR=172.20.10.13 npm run probe
```

Preduvjet: iPhone Personal Hotspot uključen + spojen USB-om (ili WiFi tether). Provjera:
```bash
ifconfig | grep 172.20.10.        # mora postojati inet 172.20.10.x
curl -s --interface 172.20.10.13 https://api.ipify.org   # pokaže mobilni IP
```

> Dokazano 2026-06-08: dok je statički IP banan (403 na sve), `SOFA_VIA_IPHONE=1 npm run probe`
> → **200** na svim endpointima; povučena stvarna utakmica Hrvatska 2–1 Slovenija (07.06.).

## Rate-limit higijena (da se ne ponovi)

- **Ne spuštaj delay za bulk.** Drži 1500–4000ms; velike povijesne pullove radi **preko noći s
  velikim delayom** (docs/03), ne danju zbijeno.
- **Ne re-runaj** backfill/history bezveze; honoriraj `ETag` (304) — TODO u kodu.
- **Testiraj na jednom timu** (`history --team=ID`), ne svih 48.
- **Circuit breaker** (4×403 → 15min) je tu; produkcijski **scheduler** je nizak volumen pa ne
  pali ban. Kad se ipak dogodi 403-sve: prebaci na `--via-iphone` ili čekaj sat+.
- Mobilni IP nije neograničen — i njega štedi (isti principi).
