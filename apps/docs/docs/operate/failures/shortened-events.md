---
title: Shortened Treasury events
---

The reported decoder defect is confirmed with the pinned o1js dependency.
The backend fix restores shortened current events before the handlers decode them.
No contract change or database migration is required for this fix.

## Evidence

All five Treasury Owner event arrays have an even field count, including the discriminator.
Each array ends with the sender public key parity field.
Removing a final zero preserves the event commitment.
It also preserves the AccountUpdate hash after JSON serialization and parsing.
Removing two fields, or removing a final one, changes the event commitment in the regression fixtures.

The old decoder returned the shortened array without removing its discriminator.
The new regression tests failed for all five event types before the fix.
The shifted fields then failed the handler checks.

The processor retries an unhandled event five times by default.
It then records a blocked failure and keeps the cursor before that event.
Later events cannot proceed while this failure remains blocked.
The failure persists across restarts, but an explicit retry can resolve it after the decoder is fixed.

These checks reproduce the commitment property and backend defect locally.
They do not reproduce the reported Mesa Lightnet transaction, proof verification, or Archive inclusion.

## Applied fix

The decoder first validates the discriminator against the expected event type.
It obtains the payload width from the current SDK event schema.
It accepts the complete array, or an array with exactly one missing final field when the complete array has even width.
For the shortened form, it removes the discriminator and appends zero to a new payload array.
It keeps the stored Archive data unchanged.

The handlers retain their field, public key, integer, Boolean, and enum checks.
Malformed raw data cannot fall back to named payload properties.
The decoder rejects stripped field arrays and the old execution layout with a recipient field.
The existing named-payload path, used when no raw field array exists, is outside this field-format change.

Tests cover all five event types, known and unknown routing types, unchanged handler facts, invalid fields, and invalid widths.
Pipeline tests cover later proposals, duplicate polling, cursor progress, orphan removal, and canonical recovery.
Existing suites cover vote totals, payout checks, lifecycle isolation, database failures, blocked retries, and transaction ordering.

## Validation results

The local regression run passed 354 tests: 229 API tests, 64 indexer tests, and 61 processor tests.
No tests were skipped in these suites.
Formatting and diff checks passed for the changed files.

Run these commands from the repository root:

```bash
pnpm --filter @repo/api exec node --loader ts-node/esm --test --test-concurrency=4 'test/*.test.ts'
pnpm --filter @repo/processor --filter @repo/indexer exec node --loader ts-node/esm --test --test-concurrency=4 'test/**/*.test.ts'
pnpm --filter @repo/api check-types
pnpm --filter @repo/processor --filter @repo/indexer check-types
```

The API type check currently fails in files outside this patch.
`test/staking-ledger-witness-api.test.ts:92` passes an incompatible object type to `Account.fromJSON`.
`packages/sdk/src/ledgers/staking-ledger/ledger-json-bytes.ts:33` uses `String.isWellFormed` with an older TypeScript library target.
These files have concurrent changes and were not changed for this fix.
The runtime tests pass, but the failed type check remains a release check to resolve.

## Deployment and recovery

1. Deploy the corrected processor build.
2. Check the processor status and the stored failure snapshot.
3. Stop the processor worker before a manual recovery run.
4. For an existing blocked shortened event, run `pnpm --filter @repo/api processor:retry-blocked` with the deployment environment.
5. Restart the processor worker.
6. Confirm that the failure is resolved and the cursor advances through later events.

Do not delete the event or manually advance the cursor.
Keep the Archive snapshot as evidence.
The deployment does not need a legacy-data migration.

## Planned isolation for other invalid events

The applied fix removes this attack path.
Other unhandled events can still block the global processor.
General quarantine remains separate work because skipping an event can leave a proposal projection incomplete.

1. Add an explicit permanent decoding error result. Keep database and dependency failures retryable.
2. Store a quarantine record with the original event, change sequence, schema identifier, error, and timestamps.
3. Roll back all handler writes before quarantine. Save the quarantine record and ingestion cursor in one transaction.
4. If a proposal can be identified safely, mark its projection incomplete and continue processing unrelated proposals.
5. If the proposal cannot be identified safely, expose global projection incompleteness. Do not report complete totals or readiness.
6. Add an explicit recovery operation that decodes the retained event and rebuilds the affected projection in source order.

Acceptance tests must prove that a quarantined event does not block an unrelated proposal.
They must also prove that incomplete projections remain visible as incomplete.
Cover crashes between quarantine and cursor writes, repeated polling, concurrent workers, retries, and pending-to-canonical changes.
Recovery must restore vote totals and payouts without duplicate effects.
