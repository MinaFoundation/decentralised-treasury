# Provable Troubleshooting

Most provable workflow failures fall into one of four areas: witness data, trace/replay mismatch, worker runtime, or persistent lifecycle state.

## Proof or Circuit Assertion Fails

Likely causes:

- the witness does not match the public root,
- the wrong ledger snapshot was used,
- a padded batch or dummy action was prepared incorrectly,
- a proof was merged with an incompatible neighbor,
- a contract precondition no longer matches the local transaction setup.

What to check:

- Confirm the test or service uses the expected staking, voting, or nullifier root.
- Re-run the focused test with proofs disabled first when possible.
- Inspect the trace generation step before debugging the proving worker.
- Check whether the failure happens during base proof generation, merge, exhaustion, or final transaction construction.

## Trace Replay Fails

Likely causes:

- trace artifacts were produced from different source data than the prover is replaying,
- lifecycle storage contains stale traces or proofs,
- a recording ledger captured an unexpected read/write sequence,
- Archive action data changed or the wrong action-state target was used.

What to check:

- Clear lifecycle-specific persistent state before retracing.
- Recreate traces from the same staking ledger or proposal action source.
- Verify whether the failing trace belongs to staking-to-voting digest replay or vote reducer run-batch replay.
- For vote reducer traces, confirm the action-state target matches the actions being reduced.

## Worker Jobs Do Not Complete

Likely causes:

- Redis is unavailable,
- no worker is running,
- a worker child process times out,
- task retry settings are too low for slow proof generation,
- `PROOFS_ENABLED` is missing where proof generation is expected.

What to check:

- Start package Docker helpers if the local flow expects Redis.
- Confirm workers are registered with the task definitions used by the queued job.
- Inspect `TASK_ATTEMPTS`, `TASK_BACKOFF_MS`, and `MAX_TASK_DURATION_MS`.
- Run a focused proof task test before debugging a full service flow.

## Proof Merge Stalls

Likely causes:

- base proofs are missing,
- proofs are not adjacent,
- vote reducer action hashes do not connect,
- staking-to-voting proof segments do not cover a continuous range.

What to check:

- Confirm each expected trace has a corresponding base proof.
- For staking-to-voting, inspect whether digest proofs cover neighboring account ranges.
- For vote reducer, inspect input and output action hashes.
- Re-run merge orchestration only after base proof storage looks complete.

## Tallying Fails After Proofs Are Built

Likely causes:

- the treasury proposal expects a different staking epoch ledger hash,
- the voting ledger root used by the vote reducer proof does not line up with the staking-to-voting proof,
- proposal status or timing preconditions are not satisfied,
- pause state blocks the operation.

What to check:

- Compare the staking-to-voting proof output with the vote reducer proof input.
- Verify proposal lifecycle timing and status before the tally transaction.
- Check whether the pause controller is blocking proposal operations.
- Re-run the owner-level integration test that most closely matches the flow.

## Related Docs

- [Treasury overview](../treasury/index.md)
- [Treasury concepts](../treasury/concepts.md)
- [Architecture](architecture.md)
- [Workflows](workflows.md)
- [Testing](testing.md)
- [Reference](reference.md)

## Related Specs

- [Staking ledger to voting ledger](../../specs/provable/staking-ledger-to-voting-ledger.md)
- [Vote reducer](../../specs/provable/vote-reducer.md)
- [Treasury owner](../../specs/provable/treasury-owner.md)
- [Treasury proposal](../../specs/provable/treasury-proposal.md)
- [Treasury pause controller](../../specs/provable/treasury-pause-controller.md)

