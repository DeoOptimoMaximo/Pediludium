#!/bin/bash
# Bring the local Postgres back up if it isn't answering (docs/21 §2C).
#
# WHY A GUARD AND NOT A SETTING. The obvious fix is Docker Desktop's "start at login". On this
# machine that toggle is broken: settings-store.json carries
#   AutoStart = False
#   AutoStartError = "option disabled because operation is not permitted when registering app service"
# macOS refuses the login-item registration, so the setting cannot be relied on — and a fix that
# lives only in an app's preferences isn't in the repo, isn't reviewable, and doesn't survive a
# reinstall. This script is the fix, and it is versioned with the code that depends on it.
#
# WHAT ACTUALLY HAPPENED. Reconstructing matchsync.log found eighteen separate outages between
# 2026-06-18 and 2026-07-18, most starting late evening and lasting 8–20 hours, plus one of six
# days after the 2026-07-14 reboot. The overnight shape fits dark wake: launchd fires its interval
# job while the Mac is in a low-power wake, the Docker VM has not resumed, the connection is
# refused, the machine sleeps again — every tick exiting 0 the whole time. Docker's Resource Saver
# is also on (UseResourceSaver=true, 300s), which makes an idle VM likelier to be parked.
#
# Called from health-check.sh only when the DB check is red, so in a healthy system it never runs.
# Idempotent and conservative: it starts things, never stops or resets anything.

set -u
export PATH="/Users/ms/.nvm/versions/node/v24.16.0/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

PROJECT_DIR="/Users/ms/git/DeoOptimoMaximo/Pediludium"
DB_HOST=127.0.0.1
DB_PORT=56322

log() { echo "[$(date -u +%FT%TZ)] supabase-guard: $*"; }

pg_up() { nc -z -G 3 "$DB_HOST" "$DB_PORT" >/dev/null 2>&1; }

if pg_up; then
  log "Postgres već odgovara — nema što raditi"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  log "Docker engine ne odgovara — pokrećem Docker Desktop"
  open -a Docker || { log "open -a Docker nije uspio"; exit 1; }
  # Cold start of the VM is tens of seconds; poll rather than guess a sleep.
  for _ in $(seq 1 30); do
    sleep 5
    docker info >/dev/null 2>&1 && break
  done
  if ! docker info >/dev/null 2>&1; then
    log "Docker se nije podigao u 150 s — potrebna ručna intervencija"
    exit 1
  fi
  log "Docker engine je gore"
fi

# Containers may exist but be paused/stopped (dark wake, Resource Saver) — starting the existing
# ones is cheaper and safer than `supabase start`, which can recreate them.
if docker ps -a --format '{{.Names}}' | grep -q '^supabase_db_pediludium$'; then
  log "kontejneri postoje — unpause + start"
  docker unpause $(docker ps -q --filter 'name=_pediludium' --filter 'status=paused') >/dev/null 2>&1 || true
  docker start $(docker ps -aq --filter 'name=_pediludium') >/dev/null 2>&1 || true
else
  log "kontejneri ne postoje — supabase start"
  (cd "$PROJECT_DIR" && supabase start) || { log "supabase start nije uspio"; exit 1; }
fi

for _ in $(seq 1 24); do
  sleep 5
  if pg_up; then
    log "Postgres je opet dostupan"
    exit 0
  fi
done

log "Postgres i dalje ne odgovara nakon oporavka — potrebna ručna intervencija"
exit 1
