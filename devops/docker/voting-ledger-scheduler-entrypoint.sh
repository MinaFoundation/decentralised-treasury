#!/bin/sh
# Poll loop for the voting-ledger-scheduler container. Not a long-lived Node
# process: every cycle it shells out to the existing `staking-ledger` /
# `staking-ledger-to-voting-ledger` CLI commands, the same way
# devops/TESTNET.md documents doing this by hand (minus dotenvx - the
# container gets its config from Compose `environment:`, not from
# apps/cli/.env.testnet, since it doesn't need the private keys that file
# also holds).
#
# Auto-processing only ever looks at the *newest* arrived, not-yet-done
# lifecycle - it never scans backward through the backlog. To (re)process a
# specific past lifecycle, run this same script by hand against the already
# running container, e.g.:
#   docker exec voting-ledger-scheduler /bin/sh devops/docker/voting-ledger-scheduler-entrypoint.sh process-lifecycle 17
set -eu

SQLITE_DATA_DIRECTORY="${SQLITE_DATA_DIRECTORY:-/data/sqlite}"
STAKING_LEDGERS_DIRECTORY="${STAKING_LEDGERS_DIRECTORY:?Set STAKING_LEDGERS_DIRECTORY}"
LIFECYCLE_PERIOD_DURATION="${LIFECYCLE_PERIOD_DURATION:-7140}"
TREASURY_DEPLOYED_AT_SLOT="${TREASURY_DEPLOYED_AT_SLOT:-0}"
POLL_INTERVAL_SECONDS="${VOTING_LEDGER_SCHEDULER_POLL_INTERVAL_SECONDS:-30}"

# One treasury lifecycle spans this many staking-ledger epochs (periods).
NUMBER_OF_PERIODS_PER_LIFECYCLE=4

run_cli() {
  pnpm run cli -- "$@"
}

deployed_epoch() {
  echo $(( TREASURY_DEPLOYED_AT_SLOT / LIFECYCLE_PERIOD_DURATION ))
}

# Prints the lifecycle id for a given epoch, or returns 1 if the epoch
# doesn't start a lifecycle (same rule as the old TS `lifecycleIdForEpoch`).
lifecycle_id_for_epoch() {
  epoch=$1
  deployed_epoch=$2
  offset=$(( epoch - deployed_epoch ))
  if [ "$offset" -lt 0 ] || [ $(( offset % NUMBER_OF_PERIODS_PER_LIFECYCLE )) -ne 0 ]; then
    return 1
  fi
  echo $(( offset / NUMBER_OF_PERIODS_PER_LIFECYCLE ))
}

epoch_for_lifecycle_id() {
  lifecycle_id=$1
  deployed_epoch=$2
  echo $(( deployed_epoch + lifecycle_id * NUMBER_OF_PERIODS_PER_LIFECYCLE ))
}

db_path() {
  echo "${SQLITE_DATA_DIRECTORY}/$1.sqlite"
}

done_marker_path() {
  echo "$(db_path "$1").done"
}

# Scans STAKING_LEDGERS_DIRECTORY for the newest <epoch>-<hash>.tar.gz whose
# lifecycle isn't done yet. Sets NEWEST_EPOCH/NEWEST_FILE/NEWEST_HASH/
# NEWEST_LIFECYCLE_ID, or NEWEST_EPOCH=-1 if there's nothing to do.
find_newest_unprocessed() {
  deployed_epoch=$(deployed_epoch)
  NEWEST_EPOCH=-1
  NEWEST_FILE=""
  NEWEST_HASH=""
  NEWEST_LIFECYCLE_ID=""

  for path in "$STAKING_LEDGERS_DIRECTORY"/*.tar.gz; do
    [ -e "$path" ] || continue
    file=$(basename "$path")
    rest=${file%.tar.gz}
    epoch=${rest%%-*}
    hash=${rest#*-}
    case "$epoch" in
      ''|*[!0-9]*) continue ;;
    esac
    [ -n "$hash" ] || continue

    lifecycle_id=$(lifecycle_id_for_epoch "$epoch" "$deployed_epoch") || continue
    [ -e "$(done_marker_path "$lifecycle_id")" ] && continue

    if [ "$epoch" -gt "$NEWEST_EPOCH" ]; then
      NEWEST_EPOCH=$epoch
      NEWEST_FILE=$file
      NEWEST_HASH=$hash
      NEWEST_LIFECYCLE_ID=$lifecycle_id
    fi
  done
}

# Finds the <epoch>-<hash>.tar.gz matching the expected epoch for a given
# lifecycle id. Sets CANDIDATE_EPOCH/CANDIDATE_FILE/CANDIDATE_HASH.
find_candidate_for_lifecycle() {
  lifecycle_id=$1
  deployed_epoch=$(deployed_epoch)
  expected_epoch=$(epoch_for_lifecycle_id "$lifecycle_id" "$deployed_epoch")
  CANDIDATE_EPOCH=""
  CANDIDATE_FILE=""
  CANDIDATE_HASH=""

  for path in "$STAKING_LEDGERS_DIRECTORY"/*.tar.gz; do
    [ -e "$path" ] || continue
    file=$(basename "$path")
    rest=${file%.tar.gz}
    epoch=${rest%%-*}
    hash=${rest#*-}
    case "$epoch" in
      ''|*[!0-9]*) continue ;;
    esac
    [ -n "$hash" ] || continue
    [ "$epoch" -eq "$expected_epoch" ] || continue

    CANDIDATE_EPOCH=$epoch
    CANDIDATE_FILE=$file
    CANDIDATE_HASH=$hash
    break
  done

  if [ -z "$CANDIDATE_FILE" ]; then
    echo "[voting-ledger-scheduler] no staking ledger file found for lifecycleId=${lifecycle_id} (expected epoch=${expected_epoch}) in ${STAKING_LEDGERS_DIRECTORY}" >&2
    return 1
  fi
}

# Processes one candidate end-to-end: extract, hydrate, verify hash,
# trace-digest, mark done. Always resets any prior partial state for that
# lifecycle first, since trace-digest always resumes from index 0 - a dirty
# retry would replay already-committed batches against advanced state.
process_candidate() {
  epoch=$1
  file=$2
  expected_hash=$3
  lifecycle_id=$4

  candidate_started_at=$(date +%s)

  echo "[voting-ledger-scheduler] processing epoch=${epoch} lifecycleId=${lifecycle_id} file=${file}"

  db_path=$(db_path "$lifecycle_id")
  rm -f "$db_path" "$db_path-journal" "$db_path-wal" "$db_path-shm"

  tmp_dir=$(mktemp -d)

  tar -xzf "${STAKING_LEDGERS_DIRECTORY}/${file}" -C "$tmp_dir"
  staking_ledger_path="${tmp_dir}/${epoch}.json"

  step_started_at=$(date +%s)
  if ! run_cli staking-ledger from-file \
    --lifecycle-id "$lifecycle_id" \
    --staking-ledger-path "$staking_ledger_path"; then
    echo "[voting-ledger-scheduler] staking-ledger from-file failed for epoch=${epoch} lifecycleId=${lifecycle_id} after $(( $(date +%s) - step_started_at ))s" >&2
    rm -rf "$tmp_dir"
    return 1
  fi
  echo "[voting-ledger-scheduler] staking-ledger from-file done for epoch=${epoch} lifecycleId=${lifecycle_id} in $(( $(date +%s) - step_started_at ))s"

  step_started_at=$(date +%s)
  if ! actual_hash=$(run_cli staking-ledger get-root-hash --lifecycle-id "$lifecycle_id"); then
    echo "[voting-ledger-scheduler] staking-ledger get-root-hash failed for epoch=${epoch} lifecycleId=${lifecycle_id} after $(( $(date +%s) - step_started_at ))s" >&2
    rm -rf "$tmp_dir"
    return 1
  fi
  actual_hash=$(printf '%s' "$actual_hash" | tail -n1)

  if [ "$actual_hash" != "$expected_hash" ]; then
    echo "[voting-ledger-scheduler] hash mismatch for epoch=${epoch} lifecycleId=${lifecycle_id}: computed=${actual_hash} expected=${expected_hash} (from filename)" >&2
    rm -rf "$tmp_dir"
    return 1
  fi
  echo "[voting-ledger-scheduler] hash verified for epoch=${epoch} lifecycleId=${lifecycle_id}: ${actual_hash} (in $(( $(date +%s) - step_started_at ))s)"

  step_started_at=$(date +%s)
  if ! run_cli staking-ledger-to-voting-ledger trace-digest --lifecycle-id "$lifecycle_id"; then
    echo "[voting-ledger-scheduler] trace-digest failed for epoch=${epoch} lifecycleId=${lifecycle_id} after $(( $(date +%s) - step_started_at ))s" >&2
    rm -rf "$tmp_dir"
    return 1
  fi
  echo "[voting-ledger-scheduler] trace-digest done for epoch=${epoch} lifecycleId=${lifecycle_id} in $(( $(date +%s) - step_started_at ))s"

  rm -rf "$tmp_dir"

  processed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat > "$(done_marker_path "$lifecycle_id")" <<EOF
{
  "lifecycleId": "${lifecycle_id}",
  "epoch": ${epoch},
  "ledgerHash": "${expected_hash}",
  "processedAt": "${processed_at}"
}
EOF

  echo "[voting-ledger-scheduler] done epoch=${epoch} lifecycleId=${lifecycle_id} totalElapsedSeconds=$(( $(date +%s) - candidate_started_at ))"
}

# Single-shot check: process the newest arrived lifecycle if it hasn't been
# done yet, otherwise do nothing.
process_newest() {
  find_newest_unprocessed
  if [ "$NEWEST_EPOCH" -lt 0 ]; then
    echo "[voting-ledger-scheduler] no new lifecycle to process"
    return 0
  fi
  process_candidate "$NEWEST_EPOCH" "$NEWEST_FILE" "$NEWEST_HASH" "$NEWEST_LIFECYCLE_ID"
}

# Processes one explicitly named lifecycle end-to-end. This is the manual
# entry point for reprocessing a lifecycle a previous automatic run skipped
# or crashed on - there is no automatic backward scan of the backlog.
process_lifecycle() {
  lifecycle_id=$1
  find_candidate_for_lifecycle "$lifecycle_id" || return 1
  process_candidate "$CANDIDATE_EPOCH" "$CANDIDATE_FILE" "$CANDIDATE_HASH" "$lifecycle_id"
}

case "${1:-}" in
  process-lifecycle)
    lifecycle_id="${2:?Usage: voting-ledger-scheduler-entrypoint.sh process-lifecycle <lifecycle-id>}"
    process_lifecycle "$lifecycle_id"
    ;;
  "")
    echo "[voting-ledger-scheduler] starting poll loop (interval=${POLL_INTERVAL_SECONDS}s)"
    while true; do
      if process_newest; then
        :
      else
        status=$?
        echo "[voting-ledger-scheduler] process-newest cycle exited with status ${status} - will retry next cycle" >&2
      fi
      sleep "$POLL_INTERVAL_SECONDS"
    done
    ;;
  *)
    echo "Usage: voting-ledger-scheduler-entrypoint.sh [process-lifecycle <lifecycle-id>]" >&2
    exit 1
    ;;
esac
