#!/bin/bash
# Health check (launchd: com.pediludium.health, every 30 min) — docs/21 §2A.
#
# The one job in the pipeline whose purpose is to SPEAK UP. Everything else fails safe and
# silent: the gates treat an unreachable database as "nothing to do" so a dead DB can't burn
# Firecrawl credits, and launchd reports exit 0 either way. That is how Postgres managed to be
# down eighteen separate times between 2026-06-18 and 2026-07-18 — once for six days — without a
# single signal reaching anyone.
#
# Runs deliberately WITHOUT the pipeline lock: it must be able to report on a hung run, not queue
# behind it. It only reads (plus one heartbeat write) so it cannot corrupt a concurrent tick.
#
# Alert delivery is configured in fetcher/.env (HEALTH_NTFY_TOPIC — see .env.example). With it
# unset the check still runs and logs; it just has nowhere to shout.

set -u
export PATH="/Users/ms/.nvm/versions/node/v24.16.0/bin:/usr/local/bin:/usr/bin:/bin"

FETCHER_DIR="/Users/ms/git/DeoOptimoMaximo/Pediludium/fetcher"
cd "$FETCHER_DIR" || exit 1

bash "$FETCHER_DIR/scripts/logrotate.sh"

# Same default as hourly-snapshot.sh, so the proxy check reports on the transport the pipeline
# actually tries to use rather than on "not configured".
: "${SOFA_PROXY_SERVER:=http://100.71.146.11:8888}"
export SOFA_PROXY_SERVER

echo "[$(date -u +%FT%TZ)] ===== health tick ====="
node --env-file-if-exists=.env src/health.ts --defer-db-alert
HEALTH_RC=$?

# Self-healing (docs/21 §2C): exit 2 means specifically "Postgres unreachable". Try to bring it
# back, then re-check so the alert reflects the state AFTER the repair attempt — the operator
# should hear "the DB was down and is back" or "the DB is down and I couldn't fix it", never a
# page for something that healed itself thirty seconds later.
if [ "$HEALTH_RC" -eq 2 ]; then
  bash "$FETCHER_DIR/scripts/supabase-guard.sh"
  echo "[$(date -u +%FT%TZ)] ponovna provjera nakon oporavka"
  node --env-file-if-exists=.env src/health.ts
  HEALTH_RC=$?
fi

echo "[$(date -u +%FT%TZ)] ===== health done (exit $HEALTH_RC) ====="
