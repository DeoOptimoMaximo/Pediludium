# 11 — Android app investigation (zašto app prolazi a browser ne)

Kad se naš **statički IP zabanao** (browser 403), SofaScore **Android app na istom WiFi/IP-u je
i dalje radio**. Istražili smo zašto, da znamo replicirati potpis ako zatreba. (Praktični fix za
ban je ipak egress kroz mobilni IP — [09](./09-egress-and-rate-limits.md) — pa je ova istraga
**pauzirana**, ali nalazi su vrijedni.)

## Nalazi (statička analiza APK-a, ne-root)

Uređaj: Motorola Edge 30 Ultra, **Android 15, NIJE rootan**. App: `com.sofascore.results`
v26.05.20 (split bundle: base + arm64_v8a + xxhdpi), minSdk 32, targetSdk 36.

Izvukli smo APK (`adb pull`) i `strings` na `classes*.dex`:

- **Isti host:** app ide na **`api.sofascore.com/api/v1/...`** (npr. `/api/v1/app/branches`) —
  **NE** koristi drugi host (`api.sofascore.app` postoji ali nije differentiator).
- **Klijent = OkHttp 3.12.13**, User-Agent **`okhttp/3.12.13/MAL_17.1.61`** (interceptor postavlja
  custom UA: nađen string "Adding User-Agent header"). Stari OkHttp 3.12.x.

**Zaključak:** razlika nije host nego **potpis klijenta** — drugačiji UA **i** drugačiji
**TLS/HTTP2 fingerprint** (OkHttp 3.12 / Android Conscrypt) vs Chrome. SofaScore WAF tretira app
kao zaseban "bucket" koji nije pao pod ban Chrome/browser prometa s istog IP-a.

**Test replikacije (JVM OkHttp 3.12.13, isti UA):** s **banane** IP adrese zahtjev je **visio
(no clean 200)** → naivno repliciranje samo UA + JVM-TLS nije dovoljno; blok je vezan i na
Android-Conscrypt TLS fingerprint + IP. (JVM TLS ≠ Android Conscrypt TLS.)

## Metode za live capture (ako ikad zatreba puni potpis)

Cilj: vidjeti SVE headere koje app šalje. Na **ne-root Android 7+** user-CA nije dovoljan (app
ne vjeruje user certifikatima), pa:

| Metoda | Radi? | Napomena |
|--------|-------|----------|
| Statički `strings` na dex | ✅ (host + UA) | najlakše, neinvazivno (gore) |
| mitmproxy + user CA | ❌ na A15 | app ne vjeruje user certu |
| **apk-mitm patch** (trust user CA + no pinning) | ⚠️ | apktool **kvari manifest** (`<meta-data>` line 318) — pao 2× (2.9.3 i 2.11.1) |
| objection/Frida gadget | ⚠️ | isti apktool rizik; bez roota treba repackage |
| **Emulator (Google-APIs image, rootable)** | ✅ **preporuka** | `adb root` → mitm CA kao **system cert** → stock app, bez patcha; A13/API33 drži cacerts u `/system/etc/security/cacerts` (A14 ih premjestio u APEX). Apple Silicon → arm64 image nativno. NE "Google Play" image (blokira root), NE Android TV. |

> Caveat emulatora: izlazi kroz Mac-ov IP (banan) → odgovori 403, ali mitmproxy svejedno
> uhvati **request** (UA/headere) — za trace je dovoljno. Za potvrdu 200 testiraj s ne-banane mreže.

## Praktična preporuka
Za **pristup** koristi mobilni IP egress ([09](./09-egress-and-rate-limits.md)) + Chrome (browser
TLS) — dokazano radi. Reverse-engineering OkHttp/Conscrypt potpisa ima smisla samo ako želiš
fetchati bez browsera (lakši headless klijent), i tad ide preko emulator capture-a gore.
