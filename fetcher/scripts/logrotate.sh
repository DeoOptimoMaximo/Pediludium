#!/bin/bash
# Log rotation for ~/Library/Logs/pediludium/ (docs/21 §2D).
#
# Called at the top of every launchd tick rather than installed as a newsyslog(8) rule: newsyslog
# needs root and a file in /etc, which makes the pipeline depend on machine state that isn't in
# this repo. This is a few lines, needs no privileges, and travels with the code.
#
# By 2026-07-20 matchsync.log had reached 2.3 MB of mostly undated "SKIP" lines — big enough that
# reconstructing the outage timeline meant scripting over it. Rotation keeps each file bounded
# and keeps the recent past intact: MAX_BYTES per file, KEEP generations.

set -u

LOG_DIR="${PEDILUDIUM_LOG_DIR:-$HOME/Library/Logs/pediludium}"
MAX_BYTES="${PEDILUDIUM_LOG_MAX_BYTES:-5242880}"   # 5 MB
KEEP="${PEDILUDIUM_LOG_KEEP:-3}"

[ -d "$LOG_DIR" ] || exit 0

for log in "$LOG_DIR"/*.log; do
  [ -f "$log" ] || continue
  size=$(stat -f%z "$log" 2>/dev/null || echo 0)
  [ "$size" -lt "$MAX_BYTES" ] && continue

  # Shift the generations down: .2 → .3, .1 → .2, current → .1
  i=$KEEP
  while [ "$i" -gt 1 ]; do
    [ -f "$log.$((i - 1)).gz" ] && mv -f "$log.$((i - 1)).gz" "$log.$i.gz"
    i=$((i - 1))
  done

  # Copy-then-truncate, never mv: launchd holds the file open via StandardOutPath, and renaming
  # it would leave every subsequent write going to an unlinked inode — the log would look frozen.
  cp "$log" "$log.1" && : > "$log"
  gzip -f "$log.1"
  echo "[$(date -u +%FT%TZ)] logrotate: $(basename "$log") rotiran (${size} B) → $(basename "$log").1.gz"
done
