---
title: Failures and Remedies
sidebar_label: Failures and remedies
audience: operator
page_kind: procedure
---

# Failures and Remedies

Stop the dependent operation when Mina state or proof input is uncertain. Keep
the original logs, files, transaction hashes, and direct state queries.

Read the [CLI prerequisites](../cli/prerequisites.md) before signing. Use the
[CLI command index](../reference/cli-commands.md) to check command options.

Use this recovery order:

1. Stop the affected writer or submitter.
2. Query the applicable Mina account state.
3. Check Archive progress and local process state.
4. Identify the first failed stage.
5. Apply the smallest safe remedy.
6. Reconcile Mina state and local projections.

## Kubernetes Repair Procedures

Use this page to identify the failed stage. Use the related infrastructure
runbook for cluster commands and component-specific checks.

| Failed stage | Cluster procedure |
| --- | --- |
| Archive bootstrap, storage, gaps, or GraphQL | [1a. Archive Node troubleshooting](../infrastructure/archive-node.md#troubleshooting) |
| Mina sync, peers, chain ID, public GraphQL, or Archive feed | [1b. Mina Daemon troubleshooting](../infrastructure/mina-daemon.md#troubleshooting) |
| Staking-ledger export, verification, retention, or HTTP service | [1c. Staking Ledger Provider troubleshooting](../infrastructure/staking-ledger-provider.md#troubleshooting) |
| Application deployment, scheduling, ingress, or service health | [2c. Deploy Stack troubleshooting](../infrastructure/deploy-stack.md#troubleshooting) |
| Lifecycle markers, checkpoints, queue, autoscaling, or proof artifacts | [2d. Lifecycle Pipeline troubleshooting](../infrastructure/lifecycle-pipeline.md#troubleshooting) |

After a repair, return to the applicable reconciliation step on this page.

## Lifecycle or Snapshot Mismatch

**Signal:** The staking root differs from the snapshot file name or Proposal
state.

**Likely cause:** The start slot, period duration, lifecycle ID, network, or
snapshot file is wrong.

**Safe check:** Read Treasury Owner and Proposal state. Calculate the expected
snapshot epoch. Compare the Proposal hash, file-name hash, and imported root.

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- treasury-owner read-state

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- proposal read-state \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY>

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- staking-ledger get-root-hash \
  --lifecycle-id <L>
```

**Remedy:** Select the correct unmodified snapshot. Run explicit lifecycle
processing only after all writers for that lifecycle stop.

**Reconciliation:** Confirm all three hashes are equal before proving or tally.

## Indexer Lag

**Signal:** Indexer `/status` shows a fixed cursor or a remaining count that
does not decrease.

**Likely cause:** The Archive endpoint is unavailable, on a different network,
or behind the expected height. The indexer can also have a processing error.

**Safe check:** Compare Archive heights, indexer cursors, and indexer logs.

```bash
curl http://127.0.0.1:4101/status

docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  logs --tail=200 indexer
```

**Remedy:** Correct the Archive endpoint first. Restart only the indexer when
its input is healthy.

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  restart indexer
```

**Reconciliation:** Confirm the cursor advances and new canonical events enter
the indexer API.

## Unsupported Indexer Event Blocks Progress

**Signal:** The indexer reports the same unresolved event type on each poll.
Its cursor does not advance past the affected Archive range.

**Likely cause:** The Archive range contains an event type that the current
indexer decoder does not recognize. The indexer stops the range before it
stores the next cursor.

**Safe check:** Keep the cursor unchanged. Record the event type, transaction
hash, block height, account, token ID, and raw payload from the logs and
Archive response. Confirm that the configured indexer build contains the
decoder for the deployed contract event.

**Remedy:** Do not edit or advance the cursor manually. Correct the contract,
network, or indexer version mismatch. If the deployed contract introduces a
valid new event, add and test its decoder, deploy the corrected indexer, and
let it read the same range again.

**Reconciliation:** Confirm that the corrected indexer accepts the previously
blocked event and advances from the unchanged cursor. Compare the indexed
events with the canonical Archive range and the affected Mina account state.

## Processor Lag

**Signal:** Processor `/status` shows a fixed offset or remaining event count.

**Likely cause:** The indexer input stopped, Postgres is unavailable, or one
event handler failed.

**Safe check:** Confirm indexer progress first. Then inspect processor status
and logs.

```bash
curl http://127.0.0.1:4102/status

docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  logs --tail=200 processor
```

**Remedy:** Correct the input or database error. Restart only the processor.

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  restart processor
```

**Reconciliation:** Confirm the offset advances. Compare the affected
projection with direct Mina state.

## Processor Event Handler Blocks Progress

**Signal:** The processor reports the same handler failure on each poll. Its
offset and `remainingEvents` values do not advance.

**Likely cause:** One event handler rejects the event or fails while it updates
the projection. The processor rolls back the complete batch and does not store
the next offset.

**Safe check:** Keep the offset unchanged. Record the failed event ID, type,
transaction hash, block height, handler error, and complete batch limits.
Confirm that the indexed event is canonical and that the processor build
supports its schema.

**Remedy:** Do not edit or advance the processor offset manually. Correct the
handler, schema, or database fault. Deploy the corrected processor and let it
read the same batch again.

**Reconciliation:** Confirm that the complete batch commits, the offset moves,
and later events process. Compare the affected proposal, votes, tally, and
execution projection with Mina account state and canonical Archive history.

## Proposal Content Validation Failure

**Signal:** The content preflight returns HTTP `400` or does not return both
`ok=true` and `passesSubmissionChecks=true`.

**Likely cause:** The Markdown is empty, too large, or contains rejected
language.

**Safe check:** Keep the original file. Run the content preflight from the
[ideal lifecycle](../lifecycle/ideal-lifecycle.md#4-create-a-proposal-and-reconcile).

**Remedy:** Correct the Markdown before proposal creation. Do not create the
on-chain commitment until the preflight succeeds.

After proposal creation, changed Markdown cannot match the on-chain content
commitment. Submit only the exact original file. Create a new proposal if the
content must change.

**Reconciliation:** Run the preflight again. Require both success values before
proposal creation.

## Proposal Content Upload Failure

**Signal:** `proposal create` reports a content timeout or submission error
after the Mina transaction was included.

**Likely cause:** The processor has not projected the proposal, the App API
returned HTTP `503`, or the request failed.

The CLI retries HTTP `503` and the specific missing-projection HTTP `404` for
up to 60 seconds. It does not retry network failures or other HTTP responses.

**Safe check:** Read the Proposal token account before any new submission.
Hash the exact original Markdown and compare the full content URN with the
account `zkappUri`. Then compare the processor projection.

**Remedy:** Repair or restart the App API when necessary. Wait for the proposal
projection. Submit the exact original Markdown to the existing proposal:

```bash
jq -Rs '{contents:.}' <PROPOSAL_MARKDOWN_PATH> \
  | curl -fsS -X POST \
      http://127.0.0.1:4100/proposals/<PROPOSAL_PUBLIC_KEY>/content \
      -H 'content-type: application/json' \
      --data-binary @-
```

The API recomputes the content hash. It accepts the content only when that hash
matches the `zkAppUriHash` in the processor projection.

**Reconciliation:** Read the proposal API result. Hash its raw `contents`
value. Confirm that the full content URN equals the Proposal account
`zkappUri` on the MINA network.

## SQLite Cannot Open

**Signal:** A container reports `SQLITE_CANTOPEN: unable to open database file`.

**Likely cause:** The host directory is absent, has the wrong UID, or is not
the directory configured in Compose.

**Safe check:** Render the Compose configuration. Check the resolved mount and
host permissions.

```bash
pnpm testnet:config
ls -ld <SQLITE_DATA_HOST_PATH>
```

**Remedy:** Create the exact directory and give UID `1000` write access.

```bash
mkdir -p <SQLITE_DATA_HOST_PATH>
sudo chown -R 1000:1000 <SQLITE_DATA_HOST_PATH>
```

Recreate the affected service after an environment change.

**Reconciliation:** Confirm the process can create or open `<L>.sqlite`. Then
confirm the expected status route or marker advances.

## Missing `.sqlite.done` Marker

**Signal:** A staking snapshot exists, but `<L>.sqlite.done` does not exist.

**Likely cause:** Root validation or tracing failed. Newer unfinished work can
also delay an older lifecycle because each poll selects the newest candidate.

**Safe check:** Inspect the scheduler log. Calculate the expected epoch and
check the exact snapshot file.

**Remedy:** Use the stopped one-shot procedure in
[Ledgers and proving](../proving/ledgers-and-proving.md#run-the-voting-ledger-scheduler).
This action removes prior SQLite state for lifecycle `<L>`. Keep the scheduler
and cached SQLite readers stopped until you verify the marker.

**Reconciliation:** Read the marker. Confirm its lifecycle, epoch, and ledger
hash against Proposal state.

## Redis or Worker Failure

**Signal:** Proof jobs remain incomplete, workers disconnect, or Redis reports
connection errors.

**Likely cause:** Redis is unavailable. A worker can also use a different host,
port, or queue name.

**Safe check:** Inspect service state and logs. Confirm the scheduler and all
workers use the same Redis and queue.

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proving ps

docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  logs --tail=200 redis proving-worker proving-scheduler
```

**Remedy:** Correct the Redis or queue settings. Recreate the proving services
when environment values changed.

**Reconciliation:** Confirm a new job starts and completes. Confirm the
scheduler writes the expected proof files and `.sqlite.proven` marker.

## Proof Generation Failure

**Signal:** The proving scheduler logs a failed digest, merge, or exhaust
stage. A `.sqlite.done` marker exists without `.sqlite.proven`.

**Likely cause:** A trace, proof file, queue, worker, or proof configuration is
incomplete or inconsistent.

**Safe check:** Compare lifecycle IDs, roots, proof paths, and verification
keys. Keep tally submission stopped.

**Remedy:** Correct the failed input. Use the stopped one-shot procedure in
[Ledgers and proving](../proving/ledgers-and-proving.md#run-automated-staking-conversion-proofs).
Keep Redis and the proof workers active. Keep the automatic scheduler stopped
until you verify the proof marker.

**Reconciliation:** Confirm the exhausted proof path and `.sqlite.proven`
marker. Compare the staking root with Proposal state before tally.

## Ledger Signing Failure

**Signal:** The CLI rejects the account index, public key, network, or device
connection.

**Likely cause:** The Mina app is closed, Ledger Live holds the device, blind
signing is off, or the configured index is wrong.

**Safe check:** Stop the transaction. Read the public key at the intended index.
Confirm `MINA_NETWORK_ID` without signing.

**Remedy:** Close Ledger Live. Unlock the Ledger. Open the Mina app and enable
blind signing. Correct the explicit public key and index pair.

**Reconciliation:** Review the network, fee payer, nonce, and signed account
updates on the device. Query Mina state after submission.

## Transaction Submission Is Uncertain

**Signal:** The CLI exits before it confirms inclusion, or the result is not
available from one Mina endpoint.

**Likely cause:** The node is slow, the connection failed, the transaction was
dropped, or a chain reorganization removed the observed result.

**Safe check:** Do not submit a duplicate. Query the expected account state and
fee-payer nonce from the target network. Query a second provider when one is
available.

**Remedy:** Retry only after Mina state shows that the first transaction did
not apply. Build the retry with the current nonce and current contract state.

**Reconciliation:** Confirm the expected state transition on the MINA network.
Then confirm Archive and processor projections reach the same result.

## Pause or Rotation Failure

**Signal:** A break-glass transaction rejects the nonce, participant
commitment, signature slot, or action data.

**Likely cause:** One signer used stale state, a different key order, or a
different action package.

**Safe check:** Read current Pause Controller state. Compare every partial
signature record with the current nonce and ordered participants.

**Remedy:** Discard signatures for stale or different data. Create new partial
signatures from current state. Do not move a signature to another slot.

**Reconciliation:** Confirm the new pause state or key commitment. Confirm the
nonce increased exactly once. For proposal toggles, read Proposal state and do
not trust the event `paused` field.

## Emergency Withdrawal Failure

**Signal:** `treasury-owner emergency-withdraw` rejects before submission, the MINA network rejects the transaction, or the result is uncertain.

**Likely cause:** The deployment uses `proof`, or its permissions do not match
the recorded mode. Other causes include a wrong key, low balance, wrong
recipient, wrong network, or a connection failure after submission.

**Safe check:** Stop all withdrawal retries. Read the Owner account, recipient account, fee-payer nonce, Owner nonce, and transaction status on the intended MINA network. Confirm the Owner address and the exact deployed `access` and `send` permissions.

**Remedy:** For a proof-only deployment, do not retry the emergency command.
Use normal proof-authorized Proposal execution when applicable. Otherwise,
deploy a new Owner address with `proofOrSignature`.
Do not use `ALLOW_DEPLOY_TO_EXISTING_ACCOUNT` to repair permissions.
`setPermissions=impossible` makes the selection permanent for the address.

**Reconciliation:** Confirm that the Owner balance decreased by the withdrawal amount and the recipient balance increased by the same amount. If the Owner also paid the fee, include that fee in its balance change. A separate fee payer can also pay a recipient account-creation fee. Confirm that no Proposal `paidOutAmount` changed.

## Insufficient Shared Treasury Balance

**Signal:** Full execution fails because Treasury Owner does not hold the
requested remaining amount.

**Likely cause:** Another transaction used the shared balance. Approved
proposals do not reserve funds.

**Safe check:** Read Treasury Owner balance and Proposal `paidOutAmount` on the
MINA network.

**Remedy:** Select an execution amount that does not exceed both remaining
Proposal amount and current Treasury Owner balance.

**Reconciliation:** Confirm Treasury Owner, recipient, and `paidOutAmount`
changes after each partial execution.

## Sources

- `devops/TESTNET.md`
- `devops/compose.yml`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `devops/docker/proving-scheduler-entrypoint.sh`
- `apps/cli/src/commands/proposal-content-api.ts`
- `apps/cli/src/ledger/transaction-signer.ts`
- `apps/cli/src/commands/pause-controller.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `packages/indexer/src/events-indexer.ts`
- `packages/indexer/src/events-repository.ts`
- `packages/processor/src/events-processor.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `devops/runbooks/1-Network/1a-Archive-Node/README.md`
- `devops/runbooks/1-Network/1b-Mina-Daemon/README.md`
- `devops/runbooks/1-Network/1c-Staking-Ledger-Provider/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/README.md`
- `devops/runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md`
