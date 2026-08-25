#!/bin/sh
# Poll loop for the voting-ledger-scheduler container. Not a long-lived Node
# process: every cycle it shells out to the existing `staking-ledger` /
# `staking-ledger-to-voting-ledger` CLI commands, the same way
# devops/TESTNET.md documents doing this by hand (minus dotenvx - the
# container gets its config from Compose `environment:`, not from
# apps/cli/.env.testnet, since it doesn't need the private keys that file
# also holds).
#
# This script knows nothing about Mina epochs. Mina resets the epoch number to
# 0 at every hardfork, so an epoch number identifies a staking ledger only
# within one era - across a fork it is ambiguous, and "highest epoch" can name
# a ledger years out of date. The ledger *hash* is the stable identifier, and
# it is the one the circuits actually enforce: a proposal snapshots
# `stakingEpochData.ledger.hash` on-chain at creation, and
# treasury-proposal.ts asserts the hydrated ledger's Merkle root equals that
# snapshot. Hydrate from the wrong ledger and every proposal in the lifecycle
# is unprovable.
#
# So the sync sidecar - not this script - decides which ledger a lifecycle
# needs, and leaves a content-addressed store behind:
#
#   <STAKING_LEDGERS_DIRECTORY>/<ledgerHash>.json    payload, named by its root
#   <STAKING_LEDGERS_DIRECTORY>/lifecycle-<id>.hash  pointer, one hash per line
#
# This script just follows the pointers. To (re)process a specific lifecycle by
# hand against a running container:
#   docker exec voting-ledger-scheduler /bin/sh devops/docker/voting-ledger-scheduler-entrypoint.sh process-lifecycle 17
set -eu

SQLITE_DATA_DIRECTORY="${SQLITE_DATA_DIRECTORY:-/data/sqlite}"
STAKING_LEDGERS_DIRECTORY="${STAKING_LEDGERS_DIRECTORY:?Set STAKING_LEDGERS_DIRECTORY}"
POLL_INTERVAL_SECONDS="${VOTING_LEDGER_SCHEDULER_POLL_INTERVAL_SECONDS:-30}"

# Retry backoff for a lifecycle that failed. Doubles per attempt from the base
# up to the cap, so a genuinely broken lifecycle stops burning ~17h of CPU on
# every poll while still being retried without operator involvement. This is
# the fix for the old behaviour, where a failed lifecycle was abandoned the
# moment a newer one arrived and only `process-lifecycle` could recover it.
FAILURE_BACKOFF_BASE_SECONDS="${FAILURE_BACKOFF_BASE_SECONDS:-300}"
FAILURE_BACKOFF_MAX_SECONDS="${FAILURE_BACKOFF_MAX_SECONDS:-21600}"

# Optional trace-digest checkpointing. Off unless both are set (and
# CHECKPOINT_INTERVAL is a positive integer) - unset is the same as today's
# behaviour: hydrate, verify, trace-digest start-to-finish in one CLI call.
# When on, a run interrupted mid-trace-digest resumes from its last
# checkpoint instead of restarting from index 0, which is what makes running
# this workload on spot capacity viable - see `checkpointing_enabled()` and
# the branch on `resume_index` in process_candidate().
CHECKPOINT_S3_URI="${CHECKPOINT_S3_URI:-}"
CHECKPOINT_INTERVAL="${CHECKPOINT_INTERVAL:-}"

checkpointing_enabled() {
  [ -n "$CHECKPOINT_S3_URI" ] || return 1
  [ -n "$CHECKPOINT_INTERVAL" ] || return 1
  [ "$CHECKPOINT_INTERVAL" -gt 0 ] 2>/dev/null
}

# Base58 (Mina omits 0, O, I, l), leading 'j' for a ledger hash. Anything that
# does not match is a corrupt or truncated pointer and is refused loudly rather
# than passed downstream as an empty string.
LEDGER_HASH_PATTERN='^j[1-9A-HJ-NP-Za-km-z]\{40,60\}$'

log_info() { echo "[voting-ledger-scheduler] $*"; }
log_warn() { echo "[voting-ledger-scheduler] WARN $*" >&2; }
log_error() { echo "[voting-ledger-scheduler] ERROR $*" >&2; }

run_cli() {
  pnpm run cli -- "$@"
}

now_epoch_seconds() { date +%s; }

db_path() {
  echo "${SQLITE_DATA_DIRECTORY}/$1.sqlite"
}

done_marker_path() {
  echo "$(db_path "$1").done"
}

failed_marker_path() {
  echo "$(db_path "$1").failed"
}

pointer_path() {
  echo "${STAKING_LEDGERS_DIRECTORY}/lifecycle-$1.hash"
}

ledger_payload_path() {
  echo "${STAKING_LEDGERS_DIRECTORY}/$1.json"
}

# Reads and validates the ledger hash a lifecycle is pinned to. Returns 1 with
# a loud message when the pointer is missing or malformed - never an empty
# string, which would silently hydrate nothing.
read_pointer() {
  lifecycle_id=$1
  path=$(pointer_path "$lifecycle_id")

  if [ ! -f "$path" ]; then
    log_error "no pointer for lifecycleId=${lifecycle_id} at ${path} - the staking-ledgers sync has not resolved this lifecycle yet"
    return 1
  fi

  hash=$(head -n1 "$path" | tr -d ' \t\r\n')
  if ! echo "$hash" | grep -q "$LEDGER_HASH_PATTERN"; then
    log_error "pointer for lifecycleId=${lifecycle_id} is not a valid ledger hash: '${hash}' (from ${path})"
    return 1
  fi

  echo "$hash"
}

# Seconds remaining before a failed lifecycle may be retried; 0 when it is due.
failure_backoff_remaining() {
  marker=$1

  attempts=$(sed -n 's/.*"attempts": *\([0-9][0-9]*\).*/\1/p' "$marker" | head -n1)
  last_at=$(sed -n 's/.*"lastAttemptEpochSeconds": *\([0-9][0-9]*\).*/\1/p' "$marker" | head -n1)
  [ -n "$attempts" ] || attempts=1
  [ -n "$last_at" ] || last_at=0

  wait_seconds=$FAILURE_BACKOFF_BASE_SECONDS
  i=1
  while [ "$i" -lt "$attempts" ] && [ "$wait_seconds" -lt "$FAILURE_BACKOFF_MAX_SECONDS" ]; do
    wait_seconds=$(( wait_seconds * 2 ))
    i=$(( i + 1 ))
  done
  [ "$wait_seconds" -gt "$FAILURE_BACKOFF_MAX_SECONDS" ] && wait_seconds=$FAILURE_BACKOFF_MAX_SECONDS

  elapsed=$(( $(now_epoch_seconds) - last_at ))
  if [ "$elapsed" -ge "$wait_seconds" ]; then
    echo 0
  else
    echo $(( wait_seconds - elapsed ))
  fi
}

record_failure() {
  lifecycle_id=$1
  reason=$2

  marker=$(failed_marker_path "$lifecycle_id")
  attempts=1
  if [ -f "$marker" ]; then
    previous=$(sed -n 's/.*"attempts": *\([0-9][0-9]*\).*/\1/p' "$marker" | head -n1)
    [ -n "$previous" ] && attempts=$(( previous + 1 ))
  fi

  cat > "$marker" <<EOF
{
  "lifecycleId": "${lifecycle_id}",
  "attempts": ${attempts},
  "lastError": "${reason}",
  "lastAttemptEpochSeconds": $(now_epoch_seconds),
  "lastAttemptAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  log_error "lifecycleId=${lifecycle_id} failed (${reason}), attempt ${attempts} - retrying after backoff"
}

# Emits one pending lifecycle id per line, newest first.
# Unlike the epoch-scanning version this replaces, it considers the whole
# backlog rather than only the newest arrival: the sidecar's window already
# bounds what is on disk, which was the only reason to look at one at a time.
find_unprocessed_lifecycles() {
  pointers_seen=0
  payloads_missing=0
  candidates=""

  for path in "$STAKING_LEDGERS_DIRECTORY"/lifecycle-*.hash; do
    [ -e "$path" ] || continue
    pointers_seen=$(( pointers_seen + 1 ))

    name=$(basename "$path")
    lifecycle_id=${name#lifecycle-}
    lifecycle_id=${lifecycle_id%.hash}
    case "$lifecycle_id" in
      ''|*[!0-9]*)
        log_warn "ignoring pointer with a non-numeric lifecycle id: ${name}"
        continue
        ;;
    esac

    [ -e "$(done_marker_path "$lifecycle_id")" ] && continue

    hash=$(read_pointer "$lifecycle_id") || continue

    if [ ! -f "$(ledger_payload_path "$hash")" ]; then
      log_warn "lifecycleId=${lifecycle_id} points at ${hash} but ${hash}.json is not present yet - waiting for the staking-ledgers sync"
      payloads_missing=$(( payloads_missing + 1 ))
      continue
    fi

    marker=$(failed_marker_path "$lifecycle_id")
    if [ -f "$marker" ]; then
      remaining=$(failure_backoff_remaining "$marker")
      if [ "$remaining" -gt 0 ]; then
        log_warn "lifecycleId=${lifecycle_id} is in failure backoff, ${remaining}s remaining"
        continue
      fi
    fi

    candidates="${candidates}${lifecycle_id}
"
  done

  if [ "$pointers_seen" -eq 0 ]; then
    log_warn "no lifecycle pointers found in ${STAKING_LEDGERS_DIRECTORY} - if the staking-ledgers sync is running, this means it has not resolved any lifecycle yet"
  elif [ "$payloads_missing" -gt 0 ]; then
    log_warn "${payloads_missing} of ${pointers_seen} lifecycle pointers have no payload on disk yet"
  fi

  [ -n "$candidates" ] || return 0
  printf '%s' "$candidates" | sort -rn
}

# Processes one lifecycle end-to-end: hydrate, verify hash, trace-digest, mark
# done. Without checkpointing, always resets any prior partial state first,
# since trace-digest then always resumes from index 0 - a dirty retry would
# replay already-committed batches against advanced state. With checkpointing
# on, a checkpoint restore is attempted first; hydration only runs when there
# is none to resume from (checkpoint-restore validates the checkpoint is for
# this exact ledger hash before trusting it, so a stale one from a re-pointed
# lifecycle is discarded rather than resumed).
process_candidate() {
  lifecycle_id=$1

  candidate_started_at=$(now_epoch_seconds)
  ledger_hash=$(read_pointer "$lifecycle_id") || return 1
  staking_ledger_path=$(ledger_payload_path "$ledger_hash")

  log_info "processing lifecycleId=${lifecycle_id} ledgerHash=${ledger_hash}"

  if [ ! -f "$staking_ledger_path" ]; then
    record_failure "$lifecycle_id" "staking ledger payload ${ledger_hash}.json is missing"
    return 1
  fi

  db_path=$(db_path "$lifecycle_id")

  resume_index=""
  if checkpointing_enabled; then
    if restore_output=$(run_cli staking-ledger-to-voting-ledger checkpoint-restore \
      --lifecycle-id "$lifecycle_id" \
      --expected-ledger-hash "$ledger_hash" \
      --s3-uri "$CHECKPOINT_S3_URI"); then
      resume_index=$(printf '%s\n' "$restore_output" | sed -n 's/^RESUME_INDEX=\([0-9][0-9]*\)$/\1/p')
    else
      log_warn "checkpoint-restore failed for lifecycleId=${lifecycle_id} - falling back to a fresh hydration"
    fi
  fi

  if [ -n "$resume_index" ]; then
    log_info "resuming lifecycleId=${lifecycle_id} from checkpoint at index=${resume_index} (skipping hydration)"
  else
    rm -f "$db_path" "$db_path-journal" "$db_path-wal" "$db_path-shm"

    step_started_at=$(now_epoch_seconds)
    if ! run_cli staking-ledger from-file \
      --lifecycle-id "$lifecycle_id" \
      --staking-ledger-path "$staking_ledger_path"; then
      record_failure "$lifecycle_id" "staking-ledger from-file failed after $(( $(now_epoch_seconds) - step_started_at ))s"
      return 1
    fi
    log_info "staking-ledger from-file done for lifecycleId=${lifecycle_id} in $(( $(now_epoch_seconds) - step_started_at ))s"

    # The CLI does the base58 comparison itself and exits non-zero on mismatch,
    # so there is no stdout scraping here. A mismatch now means the payload is
    # wrong or corrupt - the expected value came from the chain, not from a
    # filename - so the payload is dropped and the sidecar re-fetches it.
    step_started_at=$(now_epoch_seconds)
    if ! run_cli staking-ledger get-root-hash \
      --lifecycle-id "$lifecycle_id" \
      --expected-root-hash "$ledger_hash"; then
      log_error "root hash mismatch for lifecycleId=${lifecycle_id}: hydrated ledger does not root to ${ledger_hash} - discarding the payload so it is re-fetched"
      rm -f "$staking_ledger_path"
      record_failure "$lifecycle_id" "root hash mismatch against ${ledger_hash}"
      return 1
    fi
    log_info "root hash verified for lifecycleId=${lifecycle_id}: ${ledger_hash} (in $(( $(now_epoch_seconds) - step_started_at ))s)"

    resume_index=0
  fi

  step_started_at=$(now_epoch_seconds)
  set -- staking-ledger-to-voting-ledger trace-digest \
    --lifecycle-id "$lifecycle_id" \
    --start-index "$resume_index"
  if checkpointing_enabled; then
    set -- "$@" \
      --checkpoint-interval "$CHECKPOINT_INTERVAL" \
      --checkpoint-s3-uri "$CHECKPOINT_S3_URI" \
      --ledger-hash "$ledger_hash"
  fi
  if ! run_cli "$@"; then
    record_failure "$lifecycle_id" "trace-digest failed after $(( $(now_epoch_seconds) - step_started_at ))s"
    return 1
  fi
  log_info "trace-digest done for lifecycleId=${lifecycle_id} in $(( $(now_epoch_seconds) - step_started_at ))s"

  if checkpointing_enabled; then
    run_cli staking-ledger-to-voting-ledger checkpoint-clean \
      --lifecycle-id "$lifecycle_id" \
      --s3-uri "$CHECKPOINT_S3_URI" \
      || log_warn "failed to remove the checkpoint for lifecycleId=${lifecycle_id} - it will sit in S3 until overwritten by a future run"
  fi

  rm -f "$(failed_marker_path "$lifecycle_id")"

  cat > "$(done_marker_path "$lifecycle_id")" <<EOF
{
  "lifecycleId": "${lifecycle_id}",
  "ledgerHash": "${ledger_hash}",
  "processedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

  log_info "done lifecycleId=${lifecycle_id} totalElapsedSeconds=$(( $(now_epoch_seconds) - candidate_started_at ))"
}

# Single-shot pass over every pending lifecycle, newest first.
process_pending() {
  pending=$(find_unprocessed_lifecycles)

  if [ -z "$pending" ]; then
    log_info "no lifecycle to process"
    return 0
  fi

  # Deliberately not `echo "$pending" | while read`: a pipeline runs the loop
  # in a subshell and the counters below would be discarded. Lifecycle ids are
  # numeric, so the default IFS split is safe here.
  selected=0
  succeeded=0
  failed=0
  for lifecycle_id in $pending; do
    selected=$(( selected + 1 ))
    if process_candidate "$lifecycle_id"; then
      succeeded=$(( succeeded + 1 ))
    else
      failed=$(( failed + 1 ))
    fi
  done

  log_info "cycle summary: selected=${selected} succeeded=${succeeded} failed=${failed}"
  [ "$failed" -eq 0 ]
}

process_lifecycle() {
  process_candidate "$1"
}

startup_banner() {
  log_info "starting poll loop (interval=${POLL_INTERVAL_SECONDS}s)"
  log_info "  sqliteDataDirectory=${SQLITE_DATA_DIRECTORY}"
  log_info "  stakingLedgersDirectory=${STAKING_LEDGERS_DIRECTORY}"
  log_info "  failureBackoff=${FAILURE_BACKOFF_BASE_SECONDS}s..${FAILURE_BACKOFF_MAX_SECONDS}s"
  log_info "  selection is keyed on ledger hash; this container parses no epoch numbers"
  if checkpointing_enabled; then
    log_info "  checkpointing enabled: interval=${CHECKPOINT_INTERVAL} indices, s3Uri=${CHECKPOINT_S3_URI}"
  else
    log_info "  checkpointing disabled: an interrupted trace-digest restarts from index 0"
  fi
}

case "${1:-}" in
  process-pending)
    # One pass over the backlog and exit. The poll loop below does the same
    # thing on a timer; this is the entry point for a one-shot run or for
    # inspecting what a cycle would do.
    process_pending
    ;;
  process-lifecycle)
    lifecycle_id="${2:?Usage: voting-ledger-scheduler-entrypoint.sh process-lifecycle <lifecycle-id>}"
    process_lifecycle "$lifecycle_id"
    ;;
  "")
    startup_banner
    while true; do
      if process_pending; then
        :
      else
        status=$?
        log_error "process-pending cycle exited with status ${status} - will retry next cycle"
      fi
      sleep "$POLL_INTERVAL_SECONDS"
    done
    ;;
  *)
    echo "Usage: voting-ledger-scheduler-entrypoint.sh [process-pending | process-lifecycle <lifecycle-id>]" >&2
    exit 64
    ;;
esac
