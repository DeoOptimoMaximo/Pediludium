#!/bin/bash
# Schedule-aware match-result sync (launchd: com.pediludium.matchsync, every 15 min).
#
# Why this exists (2026-06-14): the hourly pipeline fetches results only through the mobile-
# proxy piggyback, which is frequently asleep (net::ERR_TIMED_OUT) → finished matches sat on
# the public /scorecard as "scheduled" for hours. This job uses Firecrawl (markdown render,
# ~1 credit/match) — independent of the proxy — but ONLY while a match is actually in play or
# just ended, so credits are spent on the handful of live games, not round the clock.
#
# Flow each tick:
#   should-sync gate (cheap DB check: any match in [now-4h, now+15m] and not finished?)
#     └─ yes → refresh:fc (Firecrawl, windowed to 4h) → if match reality changed (should-publish):
#                 standings → predict:dc → predict:dcm → simulate → history:record → snapshot
#     └─ no  → exit (0 credits, 0 work)
# Result: a finished match shows up on the live site within ~15 min, with 2-3 in-play refreshes.
#
# Shares the hourly job's lock so the two never recompute/publish concurrently.

set -u
export PATH="/Users/ms/.nvm/versions/node/v24.16.0/bin:/usr/local/bin:/usr/bin:/bin"

FETCHER_DIR="/Users/ms/git/DeoOptimoMaximo/Pediludium/fetcher"
LOCK_DIR="/tmp/pediludium-snapshot.lock"   # same lock as hourly-snapshot.sh
cd "$FETCHER_DIR" || exit 1

step() {
  echo "[$(date -u +%FT%TZ)] ▶ $*"
  "$@" || echo "[$(date -u +%FT%TZ)] ⚠ step failed (exit $?) — continuing"
}

# Cheap, credit-free gate first — bail before taking the lock if nothing is in play.
if ! node src/should-sync.ts; then
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(date -u +%FT%TZ)] match-sync: pipeline busy — skipping this tick"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

echo "[$(date -u +%FT%TZ)] ===== match-sync tick ====="

# Firecrawl result fetch, windowed to matches in/just-after play (independent of the proxy).
# 18h window matches the should-sync gate: covers an overnight so an evening match that
# finishes while ticks are stale/asleep is still caught (and re-fetched FRESH — refresh:fc
# forces --max-age 0). A match drops out the moment it's marked finished, so cost stays low.
step env REFRESH_FC_SINCE_H=18 npm run refresh:fc

# Only recompute + publish when match reality actually changed (or a match is live).
if node src/should-publish.ts check; then
  step npm run standings
  step npm run predict:dc
  step npm run predict:dcm
  step npm run simulate
  step npm run history:record
  if npm run snapshot; then
    node src/should-publish.ts commit || echo "[$(date -u +%FT%TZ)] ⚠ digest commit failed (non-fatal)"
  else
    echo "[$(date -u +%FT%TZ)] ⚠ snapshot/publish failed — digest NOT committed, will retry"
  fi
else
  echo "[$(date -u +%FT%TZ)] match-sync: no reality change yet — fetched, nothing to publish"
fi

echo "[$(date -u +%FT%TZ)] ===== match-sync done ====="
