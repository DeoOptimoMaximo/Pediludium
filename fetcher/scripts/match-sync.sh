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
#   should-sync gate (cheap DB check: any match kicked off, still unfinished, and past its
#                     per-match backoff? — src/ops.ts)
#     └─ yes → refresh:fc (Firecrawl) → if match reality changed (should-publish):
#                 standings → predict:dc → predict:dcm → simulate → history:record → snapshot
#     └─ no  → exit (0 credits, 0 work)
# Result: a finished match shows up on the live site within ~15 min, with 2-3 in-play refreshes.
#
# Eligibility is match STATE, not wall clock (docs/21 §2B). The original [now-18h, now+15m]
# window quietly abandoned anything played while the DB was down; catch-up is now the default.
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

bash "$FETCHER_DIR/scripts/logrotate.sh"

# Cheap, credit-free gate first — bail before taking the lock if nothing is due.
#
# The gate's own output is captured and re-emitted as ONE timestamped line (docs/21 §2D). It used
# to print bare "[sync-gate] SKIP" straight to the log: 2 MB of undated lines, so reconstructing
# WHEN the June/July outages started meant writing a script to carry the last dated line forward.
# Every tick now leaves exactly one dated, greppable record of its outcome.
GATE_OUT=$(node --env-file-if-exists=.env src/should-sync.ts 2>&1)
GATE_RC=$?
GATE_MSG=$(printf '%s\n' "$GATE_OUT" | tail -1)
if [ "$GATE_RC" -ne 0 ]; then
  echo "[$(date -u +%FT%TZ)] match-sync SKIP — $GATE_MSG"
  exit 0
fi
echo "[$(date -u +%FT%TZ)] match-sync PROCEED — $GATE_MSG"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(date -u +%FT%TZ)] match-sync: pipeline busy — skipping this tick"
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

echo "[$(date -u +%FT%TZ)] ===== match-sync tick ====="

# Ensure the active Firecrawl key still has credits; rotate to the next funded key if not.
# The pool lives in ~/.config/firecrawl/keys.json and rotate.sh writes the chosen key to the
# CLI creds (~/Library/Application Support/firecrawl-cli/credentials.json). Rotation is NOT
# otherwise automatic — without this a depleted active key would silently fail every scrape.
ROTATE="$HOME/.config/firecrawl/rotate.sh"
[ -x "$ROTATE" ] && step bash "$ROTATE"

# Firecrawl result fetch (independent of the proxy). No REFRESH_FC_SINCE_H any more: the window
# is no longer wall-clock but match STATE plus a per-match backoff ladder (src/ops.ts, docs/21
# §2B), which is what makes catch-up automatic. Under the old 18h window a match played while
# Postgres was down had aged out before the DB came back and was never re-checked — five World
# Cup results were lost that way. A match now stays due until it is finished or 14 days old,
# while the ladder keeps a permanently stranded fixture from burning ~96 credits a day.
step npm run refresh:fc

# Knockout phase: once a tie's feeder matches are finished, re-point its placeholder slots
# (2A / W73 …) to the real qualifiers — credit-free gate fires only when something is newly
# resolvable, so we don't scrape SofaScore every tick for weeks. Runs before the publish gate
# (the digest now covers home/away team ids), and also refreshes raw.slug/customId so the next
# refresh:fc tick can fetch the re-slugged tie's result.
if node src/should-resolve-ko.ts; then
  step env RESOLVE_KO_SEEDS=1 npm run resolve:ko
fi

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
