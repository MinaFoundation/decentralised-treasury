#!/bin/sh
# Poll loop for the proving-scheduler container. Not a long-lived Node
# process: every cycle it shells out to the existing
# `staking-ledger-to-voting-ledger` CLI commands, the same way
# devops/TESTNET.md documents doing this by hand (minus dotenvx - the
# container gets its config from Compose `environment:`, not from
# apps/cli/.env.testnet, since it doesn't need the private keys that file
# also holds).
#
# Unlike voting-ledger-scheduler (which only ever chases the newest arrived
# lifecycle), this scheduler works the full backlog oldest-first: every
# lifecycle whose staking-ledger digest trace is done
# (<lifecycleId>.sqlite.done, written by voting-ledger-scheduler) needs its
# own exhausted proof before its votes can be tallied, so none can be
# skipped just because a newer lifecycle finished tracing first.
#
# The actual proving work (prove-digest/prove-merge) is farmed out over
# Redis to the proving-worker replicas via a single fixed queue name shared
# across every lifecycle - safe because the SDK's digest() step obliterates
# the queue before enqueueing a lifecycle's jobs and blocks until they all
# complete, so lifecycles are proved strictly one at a time regardless of
# how many worker replicas are draining the queue.
#
# For a one-shot recovery, stop the scheduler service. Then use
# `docker compose run --rm --no-deps proving-scheduler` with this script and
# the `process-lifecycle` argument. Start the scheduler after the command exits.
set -eu

SQLITE_DATA_DIRECTORY="${SQLITE_DATA_DIRECTORY:-/data/sqlite}"
PROVING_OUTPUT_DIRECTORY="${PROVING_OUTPUT_DIRECTORY:-${SQLITE_DATA_DIRECTORY}/proofs}"
PROVING_QUEUE_NAME="${PROVING_QUEUE_NAME:-staking-ledger-to-voting-ledger}"
PROOFS_ENABLED="${PROOFS_ENABLED:-false}"
REDIS_HOST="${REDIS_HOST:?Set REDIS_HOST}"
REDIS_PORT="${REDIS_PORT:?Set REDIS_PORT}"
POLL_INTERVAL_SECONDS="${PROVING_SCHEDULER_POLL_INTERVAL_SECONDS:-30}"

if [ "$PROOFS_ENABLED" != "true" ]; then
  echo "[proving-scheduler] PROOFS_ENABLED must be true; no proof or .sqlite.proven marker was created" >&2
  exit 1
fi

run_cli() {
  pnpm run cli -- "$@"
}

done_marker_path() {
  echo "${SQLITE_DATA_DIRECTORY}/$1.sqlite.done"
}

proven_marker_path() {
  echo "${SQLITE_DATA_DIRECTORY}/$1.sqlite.proven"
}

# Scans SQLITE_DATA_DIRECTORY for the lowest lifecycleId whose digest trace is
# done but that isn't proven yet. Sets OLDEST_LIFECYCLE_ID, or leaves it empty
# if there's nothing to do.
find_oldest_unproven() {
  OLDEST_LIFECYCLE_ID=""

  for path in "$SQLITE_DATA_DIRECTORY"/*.sqlite.done; do
    [ -e "$path" ] || continue
    file=$(basename "$path")
    lifecycle_id=${file%.sqlite.done}

    case "$lifecycle_id" in
      ''|*[!0-9]*) continue ;;
    esac

    [ -e "$(proven_marker_path "$lifecycle_id")" ] && continue

    if [ -z "$OLDEST_LIFECYCLE_ID" ] || [ "$lifecycle_id" -lt "$OLDEST_LIFECYCLE_ID" ]; then
      OLDEST_LIFECYCLE_ID=$lifecycle_id
    fi
  done
}

# Proves one lifecycle end-to-end: prove-digest, prove-merge, prove-exhaust,
# then writes the .proven marker. Leaves the lifecycle unproven (for a retry
# next cycle) if any step fails.
process_candidate() {
  lifecycle_id=$1

  candidate_started_at=$(date +%s)
  echo "[proving-scheduler] proving lifecycleId=${lifecycle_id}"

  mkdir -p "$PROVING_OUTPUT_DIRECTORY"
  merge_proof_path="${PROVING_OUTPUT_DIRECTORY}/${lifecycle_id}-merge.json"
  exhausted_proof_path="${PROVING_OUTPUT_DIRECTORY}/${lifecycle_id}-exhausted.json"

  step_started_at=$(date +%s)
  if ! run_cli staking-ledger-to-voting-ledger prove-digest \
    --lifecycle-id "$lifecycle_id" \
    --queue-name "$PROVING_QUEUE_NAME" \
    --redis-host "$REDIS_HOST" \
    --redis-port "$REDIS_PORT"; then
    echo "[proving-scheduler] prove-digest failed for lifecycleId=${lifecycle_id} after $(( $(date +%s) - step_started_at ))s" >&2
    return 1
  fi
  echo "[proving-scheduler] prove-digest done for lifecycleId=${lifecycle_id} in $(( $(date +%s) - step_started_at ))s"

  step_started_at=$(date +%s)
  if ! run_cli staking-ledger-to-voting-ledger prove-merge \
    --lifecycle-id "$lifecycle_id" \
    --queue-name "$PROVING_QUEUE_NAME" \
    --redis-host "$REDIS_HOST" \
    --redis-port "$REDIS_PORT" \
    --proof-output-path "$merge_proof_path"; then
    echo "[proving-scheduler] prove-merge failed for lifecycleId=${lifecycle_id} after $(( $(date +%s) - step_started_at ))s" >&2
    return 1
  fi
  echo "[proving-scheduler] prove-merge done for lifecycleId=${lifecycle_id} in $(( $(date +%s) - step_started_at ))s"

  step_started_at=$(date +%s)
  if ! run_cli staking-ledger-to-voting-ledger prove-exhaust \
    --lifecycle-id "$lifecycle_id" \
    --proof-output-path "$exhausted_proof_path"; then
    echo "[proving-scheduler] prove-exhaust failed for lifecycleId=${lifecycle_id} after $(( $(date +%s) - step_started_at ))s" >&2
    return 1
  fi
  echo "[proving-scheduler] prove-exhaust done for lifecycleId=${lifecycle_id} in $(( $(date +%s) - step_started_at ))s"

  proven_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat > "$(proven_marker_path "$lifecycle_id")" <<EOF
{
  "lifecycleId": "${lifecycle_id}",
  "mergedProofPath": "${merge_proof_path}",
  "exhaustedProofPath": "${exhausted_proof_path}",
  "provenAt": "${proven_at}"
}
EOF

  echo "[proving-scheduler] done lifecycleId=${lifecycle_id} totalElapsedSeconds=$(( $(date +%s) - candidate_started_at ))"
}

# Single-shot check: prove the oldest unproven lifecycle if there is one,
# otherwise do nothing. Only ever proves one lifecycle per call - the caller
# loop re-scans afterwards, so the backlog drains one lifecycle per poll
# cycle rather than all at once.
process_oldest() {
  find_oldest_unproven
  if [ -z "$OLDEST_LIFECYCLE_ID" ]; then
    echo "[proving-scheduler] no unproven lifecycle to process"
    return 0
  fi
  process_candidate "$OLDEST_LIFECYCLE_ID"
}

case "${1:-}" in
  process-lifecycle)
    lifecycle_id="${2:?Usage: proving-scheduler-entrypoint.sh process-lifecycle <lifecycle-id>}"
    process_candidate "$lifecycle_id"
    ;;
  "")
    echo "[proving-scheduler] starting poll loop (interval=${POLL_INTERVAL_SECONDS}s)"
    while true; do
      if process_oldest; then
        :
      else
        status=$?
        echo "[proving-scheduler] process-oldest cycle exited with status ${status} - will retry next cycle" >&2
      fi
      sleep "$POLL_INTERVAL_SECONDS"
    done
    ;;
  *)
    echo "Usage: proving-scheduler-entrypoint.sh [process-lifecycle <lifecycle-id>]" >&2
    exit 1
    ;;
esac
