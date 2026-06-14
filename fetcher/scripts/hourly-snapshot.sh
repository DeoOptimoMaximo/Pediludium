#!/bin/bash
# Hourly public-snapshot pipeline (launchd: com.pediludium.snapshot — see the plist
# next to this script). Fetches fresh SofaScore data (politely, headless Chrome),
# recomputes the models from the local DB, and publishes the KV/R2 snapshot that
# nogomet.domovina.ai serves.
#
# What runs inside the hourly tick (politeness budget: docs/10):
#   every hour   refresh --full (scores + schedule, ~5 req) → enrich (xG/lineups/odds/votes/
#                shotmap, windowed, ≤60 req) → predict:dc → simulate → snapshot
#   02 08 14 20  + backfill (standings + group tagging — "mali" queue per docs/10)
#   04           + history & baseline predict (nightly bulk, medium delays)
#
# A failed step logs and the chain continues — publishing a stale-but-consistent
# snapshot beats publishing nothing.

set -u
export PATH="/Users/ms/.nvm/versions/node/v24.16.0/bin:/usr/local/bin:/usr/bin:/bin"
export SOFA_HEADLESS=1

# SofaScore challenges direct /api/v1 calls + the home IP since 2026-06-11 (docs/15), so
# egress goes through the iPhone mobile-phone-proxy over Tailscale (Telemach cellular IP).
# The SPA's own calls pass; refresh/piggyback harvests them. If the phone proxy is asleep
# (iOS suspends the foreground listener) refresh upserts 0 and warns — the rest of the
# pipeline still runs on existing data (stale-but-consistent). Override/disable via env.
: "${SOFA_PROXY_SERVER:=http://100.71.146.11:8888}"
export SOFA_PROXY_SERVER

FETCHER_DIR="/Users/ms/git/DeoOptimoMaximo/Pediludium/fetcher"
LOCK_DIR="/tmp/pediludium-snapshot.lock"

cd "$FETCHER_DIR" || exit 1

# no overlap: a long nightly run simply makes the next hourly tick skip
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(date -u +%FT%TZ)] previous run still active — skipping"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

step() {
  echo "[$(date -u +%FT%TZ)] ▶ $*"
  "$@" || echo "[$(date -u +%FT%TZ)] ⚠ step failed (exit $?) — continuing"
}

HOUR=$(date +%H)
echo "[$(date -u +%FT%TZ)] ===== hourly snapshot tick (local hour $HOUR) ====="

step npm run refresh -- --full
# enrich now works via the piggyback match-view harvest (lineups/odds/votes), but is left
# OFF in cron for now: each match view is a ~10-15s SPA navigation, and nothing in the UI
# consumes match_odds/votes yet (and xG/shotmap still need the Statistics sub-tab, docs/15).
# Run manually when wanted: SOFA_PROXY_SERVER=... ENRICH_MAX_MATCHES=4 npm run enrich
# step npm run enrich

# backfill (standings + group tagging) and the nightly history/baseline fetch also use the
# direct /api/v1 path → 403 under the 2026-06 challenge, so they're DISABLED to avoid burning
# the mobile proxy IP with repeated blocks. Re-enable per hour once migrated to piggyback.
# case "$HOUR" in
#   02 | 08 | 14 | 20) step npm run backfill ;;
# esac
# if [ "$HOUR" = "04" ]; then
#   step env SOFA_DELAY_MIN_MS=2500 SOFA_DELAY_MAX_MS=6000 npm run history
#   step env SOFA_DELAY_MIN_MS=2500 SOFA_DELAY_MAX_MS=6000 npm run predict
# fi

# Change gate (src/should-publish.ts): the DC fit uses wall-clock time-decay (half-life
# 540d), so predict:dc → simulate drift a hair EVERY hour even with no match change. That
# drift flips the 4th decimal of ~50 series shards (tser/mser) → ~50 KV writes/tick × 24 =
# ~1200/day, over KV's free-tier 1000 writes/day (429 + daily "limit exceeded" email). So we
# only recompute + publish when match REALITY changed (score/status/schedule), a match is
# live, or FORCE_PUBLISH=1. Quiet hours now cost 0 KV writes. refresh always ran above (it
# only writes the local DB — no KV cost — and is what the gate then reads).
if node src/should-publish.ts check; then
  # DB-only compute (zero SofaScore calls) + publish to Cloudflare KV/R2
  step npm run standings   # group tables from match results (the /standings endpoint is blocked)
  step npm run predict:dc
  step npm run predict:dcm  # market-anchored blend (DB-only: blends DC with stored match_odds)
  step npm run simulate
  step npm run history:record   # series gets a point only on real change → meaningful for calibration
  if npm run snapshot; then
    node src/should-publish.ts commit || echo "[$(date -u +%FT%TZ)] ⚠ digest commit failed (non-fatal)"
  else
    echo "[$(date -u +%FT%TZ)] ⚠ snapshot/publish failed — digest NOT committed, will retry next tick"
  fi
else
  echo "[$(date -u +%FT%TZ)] gate: no material change — skipping recompute/publish (0 KV writes)"
fi

echo "[$(date -u +%FT%TZ)] ===== tick done ====="
