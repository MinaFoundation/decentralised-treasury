---
title: Tally Your Proposal
sidebar_label: Tally a Proposal
audience: user
page_kind: procedure
---

Download the server's staking proof and ledger database, generate the Proposal vote proof, then submit both proofs.
Use the [CLI setup](cli.md#install-the-tools), Docker, and a funded [Ledger wallet](signing-with-ledger-and-auro.md#set-up-ledger-for-the-cli).
Use the same code revision as the deployment. Any funded sender can submit a valid tally.

## Before You Start

- Wait until the Proposal reaches Cooldown or a later period. The Archive must contain all included votes.
- The Proposal must have status `UNKNOWN`. The Treasury and Proposal must not be paused.
- The proof must cover five distinct, non-initial action-state hashes from the Proposal account history.
- Participation must meet the required threshold, with some `yay` or `nay` weight.

Five action-state hashes are not the same as five unique voters.
Include votes in at least five distinct slots during Voting.
Multiple votes in one slot do not provide multiple retained history entries.
Confirm five distinct, non-initial entries before Voting ends.
A sufficient voting weight alone does not permit tallying.
Insufficient participation or all-abstain voting leaves the Proposal `UNKNOWN` because the tally transaction fails.
See [Results and Acceptance](results-and-acceptance.md) for the exact thresholds and outcomes.

## 1. Download the Inputs

Run commands from the repository root. Create `.env.tally` and replace the placeholders:

```dotenv
MINA_NODE_URL='<MINA_GRAPHQL_URL>'
NETWORK='<mainnet|devnet>'
ARCHIVE_NODE_URL='<ARCHIVE_GRAPHQL_URL>'
TREASURY_OWNER_PUBLIC_KEY='<TREASURY_OWNER_PUBLIC_KEY>'
PROPOSAL_PUBLIC_KEY='<PROPOSAL_PUBLIC_KEY>'
LIFECYCLE_PERIOD_DURATION='<COMPILED_PERIOD_SLOTS>'
SIGNER='ledger'
SENDER_PUBLIC_KEY='<YOUR_LEDGER_PUBLIC_KEY>'
SENDER_LEDGER_ACCOUNT_INDEX='<YOUR_LEDGER_ACCOUNT_INDEX>'
QUEUE_NAME='tally'
REDIS_HOST='127.0.0.1'
REDIS_PORT='6389'
MAX_TASK_DURATION_MS='3600000'
```

Choose `mainnet` or `devnet`. Use the deployment's compiled lifecycle duration.
Download from the main Treasury host, not the backoffice host, into a new directory:

```bash
dotenvx run --strict --overload -f .env.tally -- pnpm cli proposal download-tally-inputs \
  --backend-url 'https://<TREASURY_HOST>' \
  --output-directory .data/tally
```

The command reads the lifecycle ID and staking snapshot from the Proposal on Mina.
It then downloads the matching files and writes absolute local paths to `.data/tally/.env`.
Do not create the output directory first. The downloader refuses an existing directory.

The commands below load both files with dotenvx. `--strict` stops on loading errors.
With `--overload`, file values replace existing shell values; the generated file comes last so its downloaded input settings take precedence.
The generated file sets `PROOFS_ENABLED=true`. Keep that value for a real tally. Stop if any command fails.

### What the Downloaded Files Do

Here, `<L>` is the Proposal lifecycle ID.

| Remote file | Purpose |
| --- | --- |
| `/proofs/<L>-exhausted.json` | Proves the completed staking-to-voting transformation. Tracing validates it; tallying submits it alongside the vote proof. |
| `/sqlite/<L>.sqlite` | Contains staking and voting ledgers, Merkle data, and saved proving data. The reducer reads voting accounts and witnesses from this local copy. |
| `/sqlite/<L>.sqlite.done` | Records the completed ledger stage and staking snapshot hash. The downloader checks its lifecycle and snapshot. |
| `/sqlite/<L>.sqlite.proven` | Records completion of the server's staking proof work. The downloader checks its lifecycle. |

The database also supplies the historical Treasury Owner account and witness needed to calculate acceptance thresholds during tallying.
It can be several gigabytes. The proof JSON alone cannot supply these accounts and witnesses.
The marker files describe completed stages; they are not cryptographic proofs.

The downloader checks database integrity, staking snapshot consistency, and the default-token Treasury Owner's nonzero balance.
The CLI selects the Owner by public key and `TokenId.default`. It uses that same account index for the Merkle witness.
A custom-token account at the Owner address cannot replace the native-token account.
It decodes the proof and checks its snapshot and exhausted flag. Cryptographic proof verification occurs before tracing and again during tallying.

The server does not supply this Proposal's vote-reducer proof. You generate that proof in step 2.
The server's `<L>-merge.json` is a staking proof, not a replacement for your local `vote-reducer-merge.json`.

## 2. Generate the Vote Proof

In the first terminal:

```bash
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli proposal fetch-actions \
  --output-path .data/tally/vote-actions.json
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli vote-reducer compile
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli vote-reducer trace-run-batch

docker run --detach --rm --name treasury-tally-redis \
  --publish 127.0.0.1:6389:6379 redis:7-alpine
```

`fetch-actions` reads the Proposal's ordered vote actions and action-state history from the Archive.
Its JSON also identifies the Proposal public key and token ID.
`compile` prepares the vote-reducer program. `trace-run-batch` records the account witnesses and batch inputs needed for proving.

### Inputs Used by `trace-run-batch`

The generated `.data/tally/.env` provides these options automatically:

| CLI option | Environment variable | Purpose |
| --- | --- | --- |
| `--lifecycle-id` | `LIFECYCLE_ID` | Selects the lifecycle database. Must match the Proposal. |
| `--vote-actions-path` | `VOTE_ACTIONS_PATH` | Selects the actions file and Proposal-specific reducer state. |
| `--staking-ledger-to-voting-ledger-proof-path` | `STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH` | Supplies the exhausted staking proof for validation. |
| `--treasury-owner-public-key` | `TREASURY_OWNER_PUBLIC_KEY` | Identifies the Proposal's Treasury Owner. |
| `--mina-node-url` | `MINA_NODE_URL` | Reads the Proposal's lifecycle and staking snapshot from Mina. |
| `--network` | `NETWORK` | Selects `mainnet` or `devnet`. The default is `mainnet`. |

`SQLITE_DATA_DIRECTORY` points to the downloaded database directory.
The lifecycle ID selects storage; the separate proof input authenticates the voting ledger root.

Before tracing, the CLI checks the Proposal identity, lifecycle, staking snapshot, and local voting ledger root.
It requires an exhausted proof that starts at index zero with an empty voting ledger.
It compiles the local staking-to-voting program, or uses cached compilation, and verifies the proof before recording any vote traces.
The explicit local-test setting `PROOFS_ENABLED=false` skips cryptographic verification only; it does not skip the other checks.

In a second terminal at the repository root, start the worker and keep it running:

```bash
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli worker start
```

In the first terminal, generate and merge the vote proof:

```bash
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli vote-reducer prove-run-batch
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli vote-reducer prove-merge \
  --proof-output-path .data/tally/vote-reducer-merge.json
```

The worker proves the saved batches through Redis. `prove-merge` combines the batch proofs into `vote-reducer-merge.json`.
Use the same Redis host, port, and queue for the worker and both proving commands.
Run one workflow at a time on this queue. Keep the same actions file throughout the workflow.
Proof generation can take substantial time and memory.

## 3. Submit the Tally

Connect your Ledger and open the Mina app. Run:

```bash
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli proposal tally-votes
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli proposal read-state
```

The generated settings supply `VOTE_REDUCER_PROOF_PATH` and `STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH` to `tally-votes`.
The CLI loads both proofs and obtains the historical Treasury Owner witness from SQLite.
The contracts verify both proofs, require matching voting ledger roots, and check the Proposal action-state history and acceptance conditions.

Review and approve the wallet request, then save the transaction hash. The command waits for inclusion by default.
`read-state` reads the stored result from Mina:

| Status | Meaning |
| --- | --- |
| `APPROVED` | Participation and approval conditions passed. Execute only from the lifecycle after the Proposal's lifecycle. |
| `REJECTED` | Participation was sufficient, but approval was below the threshold. |
| `UNKNOWN` | No successful tally stored a result. Check the transaction and any reported error. |

Approval does not send the payout. Follow [Execute a Proposal](execute-a-proposal.md) for that separate transaction.

Press `Ctrl+C` in the worker terminal, then stop Redis:

```bash
docker stop treasury-tally-redis
```

## How the UI Shows Totals During Voting

The UI displays running totals before anyone submits a final tally transaction.
The backend processor calculates these totals as it receives indexed `proposalVoteDispatched` events:

1. It reads the Proposal's staking snapshot and checks the root and account witnesses.
2. It sums default-token balances by delegate to derive each voter's weight.
3. It counts the first surviving vote per voter for that Proposal. Later votes from that voter are nullified.
4. It adds the weights to `yay`, `nay`, and `abstain`, then calculates participation and approval.

Production derives these weights from the staking snapshot directly. These calculations do not require the staking-to-voting proof to be ready.
The backend rebuilds the totals when event status changes; orphaned events no longer contribute.
Pending events and processing delays can therefore change the displayed totals.

The Proposal API supplies running and final tallies separately.
The browser polls Mina every 10 seconds and refreshes Proposal data when the block height or hash changes.
It displays the backend totals and compares them with the acceptance thresholds.
`abstain` contributes to participation; approval uses `yay / (yay + nay)`.

During Voting, labels such as **Passing**, **Failing**, or **Waiting for votes** describe the current totals.
In Cooldown, an `UNKNOWN` Proposal shows **Awaiting on-chain result**.
A **Latest tally block** can refer to a running calculation; it does not itself prove final submission.

The browser does not generate the final vote-reducer proof or submit the final tally automatically.
Use the CLI procedure above. After inclusion, the backend processes `proposalVotesTallied` and the UI shows the stored outcome.
If the display is behind, use `proposal read-state` from step 3 to check Mina directly.

## If a Step Fails

| Problem | Next step |
| --- | --- |
| Missing `.done`, `.proven`, proof, or SQLite download | Wait for server publication. Ask the operator if files remain unavailable. |
| Output directory already exists | Keep the existing work. Use a new directory and update its paths in all commands if you need another download. |
| Proof, snapshot, lifecycle, or root mismatch | Check the deployment revision, Proposal, and downloaded inputs. Give the operator the error; do not bypass verification. |
| Reducer state already exists | Resume proving from the saved traces, or clear this Proposal's reducer state before retracing. |
| No proof jobs complete | Check that the worker is running with the same Redis host, port, and queue. Check worker errors and `MAX_TASK_DURATION_MS`. |
| Tally fails despite a positive UI result | Check participation, decisive vote weight, five distinct action-state targets, pause state, and the transaction error. |

If you must fetch a corrected actions file and retrace, stop the worker first. Clear the selected Proposal's saved reducer state:

```bash
dotenvx run --strict --overload -f .env.tally -f .data/tally/.env -- pnpm cli vote-reducer clear-state
```

This removes that Proposal's saved traces, proofs, and nullifiers. It preserves the lifecycle voting ledger and other Proposals.
Repeat step 2 and overwrite the old `vote-reducer-merge.json` before submitting. Reuse the running Redis container.
Keep completed inputs and transaction hashes for later checks.
See [Ledgers and Proving](../operate/proving/ledgers-and-proving.md#build-the-vote-reducer-proof) for the operator workflow.

## Sources

- `apps/cli/src/commands/proposal-tally-download.ts`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/src/commands/vote-reducer.ts`
- `apps/cli/src/commands/worker.ts`
- `packages/sdk/src/services/sqlite/sqlite-vote-reducer-service.ts` — proof validation and local ledger access
- `packages/sdk/src/provable/contracts/treasury-owner.ts` — tally timing and action-state requirements
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts` — proof binding and acceptance
- `apps/api/src/processors/proposals/proposal-vote-dispatched-event-handler.ts` — production weight lookup
- `apps/api/src/processors/proposals/staking-ledger-vote-weight.ts` — delegation weights from the staking snapshot
- `apps/api/src/processors/proposals/proposal-projection-reconciler.ts` — running and final totals
- `apps/api/src/proposal-list-routes.ts` — tally API fields
- `apps/web/features/mina-blocks/hooks/use-mina-block-poller.ts` — block polling
- `apps/web/features/proposals/containers/proposal-detail-page-container.tsx` — Proposal refresh
- `packages/ui/src/treasury/proposals/proposals-table.tsx` — status labels
