# 20 — Blog series plan ("Lopta je okrugla" / nogomet.domovina.ai/blog)

A living editorial plan for the technical blog. It turns the knowledge already captured in
this repo — the docs (`docs/01`–`docs/19`), `ARCHITECTURE.md`, and the commit history — into
a prioritized backlog of posts. Treat this file as the source of truth for *what to write
next and why*; update status as posts ship.

---

## 1. Why this blog exists

The site's thesis is in its name: even the best models have exceptions — **the ball is
round**. The blog is where we earn the right to make predictions in public by showing the
maths, the data plumbing, and the failures openly. It is the credibility layer of an
*open-source* football analytics product, and a portfolio of genuinely hard engineering
(anti-bot transport, cross-venue arbitrage, Monte-Carlo simulation) written for people who
want the real derivation, not a press release.

**Audience, in two tiers** (every post should serve both):
- **Curious fan** — reads the intro, the diagrams, and the "so what". Never blocked by a
  formula they can skip.
- **Technical reader** — gets the actual derivation, the model assumptions, the SQL/code, and
  honest caveats.

## 2. Editorial principles (derived from the first post)

The published post `zasto-nijedna-predikcija-nije-remi` ("The draw paradox") sets the bar:
- **Math-backed, not hand-wavy.** Derive the claim (there, from the scoreline matrix).
- **Bilingual HR + EN**, Croatian-first. Title + excerpt live in `lib/blog.ts`; body strings
  are bilingual in the renderer.
- **Live diagrams over screenshots.** Reuse `Mermaid`, `ScoreMatrix`, `SeriesChart`,
  `ProbBar` components so figures stay in sync with the real model.
- **Calibration honesty.** Prefer "is the probability right?" (Brier / log-loss) over "did we
  call the winner?" (argmax). Link to `/accuracy` and `/scorecard` for the live scoreboard.
- **Self-contained brand.** No SofaScore traces in the public UI/copy (see brand memory).
- **6–10 min read.** One idea per post, fully derived.

## 3. How to publish a post (the mechanism)

1. Add a `BlogMeta` entry to `web/lib/blog.ts` (`POSTS`, newest first): `slug`, `date`,
   `readMin`, `tags`, bilingual `title` + `excerpt`.
2. Create the renderer component in `web/app/blog/posts/<slug>.tsx` (see
   `draw-paradox.tsx`). Keep body copy bilingual, keyed by `lang`.
3. Map the slug → component in `web/app/blog/[slug]/page.tsx`.
4. Use existing chart components for figures; don't inline raw SVG unless necessary.
5. Build + deploy with the web app (`npm run deploy`). The blog is static-ish content baked
   into the Worker — no snapshot/KV dependency.

**Definition of done (per post):** derivation correct & reviewed · both languages complete ·
at least one live diagram · links to the relevant live page(s) · honest "limits / what could
make this wrong" paragraph · tags reuse existing taxonomy where possible.

## 4. Tracks & backlog

Four tracks. Within each, posts are ordered by suggested publish priority. Status:
`✅ shipped` · `▶ next` · `◻ planned`.

### Track A — Modelling (the predictions)

| # | Status | Working title (HR / EN) | Thesis / hook | Source material |
|---|--------|--------------------------|---------------|-----------------|
| A0 | ✅ | Paradoks neriješenog / The draw paradox | No prediction's argmax is a draw; the diagonal of the scoreline matrix is always outnumbered. | `draw-paradox.tsx`, `docs/13` |
| A1 | ▶ | Dixon-Coles, korak po korak / Dixon-Coles, step by step | Why a plain Poisson over/under-counts 0-0/1-0/0-1, and how the low-score correction τ + exponential time-decay weighting + weighted MLE fix it. | `fetcher/src/dixon-coles.ts`, `docs/01`, `docs/08`; commit `1d5f120` |
| A2 | ◻ | Dva modela, jedan teren / Two models, one pitch | Elo+Poisson baseline vs Dixon-Coles: what each gets right, why we keep both and let the user switch. | `fetcher/src/predict.ts`, `docs/01` |
| A3 | ◻ | Simuliramo cijeli turnir / Monte-Carlo the whole cup | Sampling 72 group games from the goal model, FIFA tie-breakers, best-8 thirds, reconstructing the 32-team bracket to a champion. | `fetcher/src/simulate.ts`, `docs/13`; commit `1d5f120` |
| A4 | ◻ | Kalibracija > pogodak / Calibration beats the call | Brier & log-loss explained from zero; why "called the winner" is a vanity metric and the reliability diagram is the real exam. | `/accuracy`, `/scorecard`, `docs/08` |
| A5 | ◻ | Rejting snage iz 10 godina / A power rating from 10 years | Goal-difference-weighted Elo built from a decade of match history; why the rating defaults to 1500 and what makes a team move. | `fetcher/src/predict.ts` (Elo loop), `team_match` table; this session's Elo-from-DB fix |
| A6 | ◻ | Zagonetka trećeplasiranih / The third-place puzzle | The 48-team format: best 8 of 12 third-placed teams advance; modelling the cross-group cutoff. | groups page; commit `8e4c8fa` |

### Track B — Data & infrastructure (getting the numbers)

| # | Status | Working title (HR / EN) | Thesis / hook | Source material |
|---|--------|--------------------------|---------------|-----------------|
| B1 | ◻ | Blok nije IP, nego otisak / The block isn't your IP, it's your fingerprint | TLS/JA3 fingerprinting: why a real browser gets through where curl is 403'd. | `docs/02`, `docs/03`, `docs/09`, `docs/15` |
| B2 | ◻ | Piggyback kroz mobilni proxy / Piggyback via a mobile proxy | Routing Chrome egress through an iPhone proxy and harvesting the SPA responses. | `docs/15`; commits `ea4a68d`, `feea9e3` |
| B3 | ◻ | Otporno višekanalno dohvaćanje / Resilient multi-transport fetching | The transport ladder: piggyback → Firecrawl render fallback; degrade, don't die. | `docs/19`; commits `83a427c`, `10bfec7`, `2879e1c` |
| B4 | ◻ | Pristojno skrejpanje / Scraping like a good guest | Rate limits, polite backoff floor, phase-aware scheduler — extracting data without hammering the host. | `docs/09`, `docs/10`; commits `72dbfdb`, `ed8198c` |
| B5 | ◻ | Satni snapshot na proračunu / Hourly snapshots on a budget | KV write-limit math, and the drift publish-gate that stops ~1000 needless writes/day. | `docs/14`; `should-publish.ts`; commit `508ad5c`; KV memory |
| B6 | ◻ | Realtime bez backenda / Realtime without a backend | Supabase Realtime + `RealtimeRefresh` to push live score changes to a static-ish site. | `docs/12`; commits `37a3281`, `135b127` |
| B7 | ◻ | Arhitektura otvorenog stacka / Architecture of an open stack | The fetcher / Postgres / web split; snapshot (KV) vs live (Supabase) data facade. | `ARCHITECTURE.md`, `docs/04`, `docs/14` |

### Track C — The edge layer (Web2 ↔ Web3 & trading)

| # | Status | Working title (HR / EN) | Thesis / hook | Source material |
|---|--------|--------------------------|---------------|-----------------|
| C1 | ◻ | Gdje se model i tržište razilaze / Where model and market diverge | What +EV and arbitrage actually mean; turning odds into probabilities and comparing venues. | `docs/16`, `docs/18` |
| C2 | ◻ | Prava arbitraža s dva tržišta / Real arbitrage with two venues | Adding Kalshi next to Polymarket to find guaranteed-profit legs; thin-market caveats. | commit `0214a8d`; `edge-scan.ts` |
| C3 | ◻ | Obrnuti inženjering SuperSport kvota / Reverse-engineering SuperSport odds | Pulling Web2 odds from a reverse-engineered `api/sbk` WebSocket. | commit `0f47ea7`; `edge-supersport.ts` |
| C4 | ◻ | Bot koji trguje lažnim novcem / A bot that trades fake money | Dry-run paper trader: simulated fills, slippage, Kelly sizing, the ledger — proving the model before risking a cent. | `docs/16`; `edge-trade.ts` |

### Track D — Product & craft (building it in public)

| # | Status | Working title (HR / EN) | Thesis / hook | Source material |
|---|--------|--------------------------|---------------|-----------------|
| D1 | ◻ | Zastavice koje rade svugdje / Flags that render everywhere | Why emoji flags vanish on Windows/Brave and how a self-hosted Twemoji subset fixes it cross-browser. | this session's flag-font fix; `lib/format.ts`, `globals.css` |
| D2 | ◻ | Dvojezični podatkovni proizvod / A bilingual data product | HR/EN i18n with no library, Croatian exonyms, and group-label localization. | `lib/i18n.ts`; commit `74778f2` |
| D3 | ◻ | Brend bez tragova izvora / A brand with no source traces | Designing a standalone identity ("Lopta je okrugla", DOMOVINA tricolor) for a scraped-data product. | brand memory; commit `e7cd9f2` |

## 5. Suggested cadence & sequencing

- **Cadence:** one post every 1–2 weeks during the tournament; tie A4/A5/A6 to moments when
  live results make calibration and movers interesting.
- **First three to write:** **A1** (Dixon-Coles — the engine everything else references),
  **A4** (calibration — pairs with the live `/accuracy` data accruing now), **B3** (resilient
  fetching — `docs/19` is fresh and the diagrams already exist).
- **Reuse what's tournament-timely:** A5 (power ranking) is a natural companion to the Elo fix
  shipped this session; publish it once the ratings spread out from 1500.

## 6. Backlog hygiene

- When a post ships, flip its status to ✅ and add the slug.
- New engineering worth a post → add a row in the right track rather than a loose TODO.
- Keep tags consistent with `lib/blog.ts` (`Dixon-Coles`, `kalibracija`, `matematika`, …);
  add new tags sparingly.
</content>
</invoke>
