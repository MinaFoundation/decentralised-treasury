#!/bin/sh
# Poll loop for the voting-ledger-scheduler container. Auto-processing is
# CLI-only and limited to whichever lifecycle just arrived — it never scans
# backward through the backlog. To (re)process a specific past lifecycle,
# run it by hand against this same running container, e.g.:
#   docker exec voting-ledger-scheduler pnpm --dir apps/cli run mina-treasury -- voting-ledger-scheduler process-lifecycle --lifecycle-id 17
set -eu

POLL_INTERVAL_SECONDS="${VOTING_LEDGER_SCHEDULER_POLL_INTERVAL_SECONDS:-30}"

echo "[voting-ledger-scheduler] starting poll loop (interval=${POLL_INTERVAL_SECONDS}s)"

while true; do
  if pnpm --dir apps/cli run mina-treasury -- voting-ledger-scheduler process-newest; then
    :
  else
    status=$?
    echo "[voting-ledger-scheduler] process-newest exited with status ${status} (128+signal means it was killed by that signal) - will retry next cycle" >&2
  fi
  sleep "$POLL_INTERVAL_SECONDS"
done
