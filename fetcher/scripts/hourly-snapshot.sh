#!/bin/bash
# Hourly public-snapshot pipeline (launchd: com.pediludium.snapshot — see the plist
# next to this script). Fetches fresh SofaScore data (politely, headless Chrome),
# recomputes the models from the local DB, and publishes the KV/R2 snapshot that
# nogomet.domovina.ai serves.
#
# What runs inside the hourly tick (politeness budget: docs/10):
#   every hour   refresh --full (scores + schedule, ~5 req) → predict:dc → simulate → snapshot
#   02 08 14 20  + backfill (standings + group tagging — "mali" queue per docs/10)
#   04           + history & baseline predict (nightly bulk, medium delays)
#
# A failed step logs and the chain continues — publishing a stale-but-consistent
# snapshot beats publishing nothing.

set -u
export PATH="/Users/ms/.nvm/versions/node/v24.16.0/bin:/usr/local/bin:/usr/bin:/bin"
export SOFA_HEADLESS=1

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

case "$HOUR" in
  02 | 08 | 14 | 20) step npm run backfill ;;
esac

if [ "$HOUR" = "04" ]; then
  step env SOFA_DELAY_MIN_MS=2500 SOFA_DELAY_MAX_MS=6000 npm run history
  step env SOFA_DELAY_MIN_MS=2500 SOFA_DELAY_MAX_MS=6000 npm run predict
fi

# DB-only compute (zero SofaScore calls) + publish to Cloudflare KV/R2
step npm run predict:dc
step npm run simulate
step npm run snapshot

echo "[$(date -u +%FT%TZ)] ===== tick done ====="
