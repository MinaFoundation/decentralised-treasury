# Mina Treasury CLI

This document focuses on practical CLI operation flows:

- compile and deploy treasury contracts
- set lifecycle start slot
- create proposals and vote
- tally votes, and execute payout
- operate pause-controller with external signatures

## Important Warnings

- **Private keys are passed in plaintext** (CLI flags / env vars). Treat this CLI as an operator/dev tool, not hardened key-management.
- **Ledger signing is not supported yet.** It will be added in the next iteration.
- Do not use production funds or production keys with the current workflow.

## Where To Run Commands

From repo root (recommended):

```bash
pnpm run cli -- <command> <subcommand> [options]
```

Alias (same behavior):

```bash
pnpm run mina-treasury -- <command> <subcommand> [options]
```

Or run directly from this package:

```bash
cd apps/cli
pnpm run mina-treasury -- <command> <subcommand> [options]
```

## Baseline Configuration For Deployment

Generate required keypairs first (run once per role and save output):

```bash
pnpm run cli -- generate-keypair --json # treasury-owner
pnpm run cli -- generate-keypair --json # pause-controller
```

Create a local env file:

```bash
cat > apps/cli/.env.local <<'EOF'
MINA_NODE_URL=https://<your-mina-node>/graphql
ARCHIVE_NODE_URL=https://<your-mina-archive-node>
PROOFS_ENABLED=true
# Recommended: set equal to epoch length in slots
LIFECYCLE_PERIOD_DURATION=<EPOCH_LENGTH_SLOTS>
TX_FEE=1000000000

SENDER_PRIVATE_KEY=<funded-fee-payer-private-key>
# Optional: account debited by fund-treasury (defaults to sender when omitted)
FUNDING_PRIVATE_KEY=<funding-account-private-key>
TREASURY_OWNER_PRIVATE_KEY=<treasury-owner-private-key>
TREASURY_OWNER_PUBLIC_KEY=<treasury-owner-public-key>
PAUSE_CONTROLLER_PRIVATE_KEY=<pause-controller-private-key>
MULTISIG_PARTICIPANTS_PUBLIC_KEYS=<PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5>
EOF
```

Load it in your shell:

```bash
set -a
source apps/cli/.env.local
set +a
```

## Set Treasury Starting Slot (`TREASURY_DEPLOYED_AT_SLOT`)

Fetch current slot:

```bash
CURRENT_SLOT=$(curl -s -X POST "$MINA_NODE_URL" \
  -H "content-type: application/json" \
  --data '{"query":"{ bestChain(maxLength: 1) { protocolState { consensusState { slotSinceGenesis } } } }"}' \
  | jq -r '.data.bestChain[0].protocolState.consensusState.slotSinceGenesis')
```

### Epoch alignment recommendation (important)

Set `TREASURY_DEPLOYED_AT_SLOT` to an **epoch start slot** (or the next epoch start slot), not an arbitrary slot.

Why:

- Proposal creation snapshots staking epoch data (`stakingEpochDataLedgerHash`, `stakingEpochDataLedgerTotalCurrency`) from protocol state.
- Tally/proof flows later must be consistent with that snapshot.
- If treasury lifecycle boundaries drift relative to epoch boundaries, proposals in different periods can be anchored to different epoch snapshots in ways that are harder to reason about and reproduce.
- The same applies to lifecycle period duration: if `LIFECYCLE_PERIOD_DURATION` is not equal to epoch length, proposal/voting/cooldown windows can straddle epoch transitions unpredictably.

Practical guidance:

- Determine `EPOCH_START_SLOT` from your node/archive tooling.
- Determine `EPOCH_LENGTH_SLOTS` for your target network and set:
  - `LIFECYCLE_PERIOD_DURATION=$EPOCH_LENGTH_SLOTS`
- Prefer:
  - `TREASURY_DEPLOYED_AT_SLOT=$EPOCH_START_SLOT`
  - or `TREASURY_DEPLOYED_AT_SLOT=<NEXT_EPOCH_START_SLOT>` for scheduled deploys.

Choose start strategy:

- Recommended (epoch-aligned immediate):
  - `TREASURY_DEPLOYED_AT_SLOT=$EPOCH_START_SLOT`
- Recommended (epoch-aligned scheduled deploy):
  - `TREASURY_DEPLOYED_AT_SLOT=$NEXT_EPOCH_START_SLOT`
- Local quick test only (not epoch-aligned):
  - `TREASURY_DEPLOYED_AT_SLOT=$CURRENT_SLOT`

Persist it:

```bash
echo "TREASURY_DEPLOYED_AT_SLOT=$TREASURY_DEPLOYED_AT_SLOT" >> apps/cli/.env.local
export TREASURY_DEPLOYED_AT_SLOT
```

## Flow 1: Compile And Deploy Treasury (Compile First)

### 1) Compile contracts and dependencies

```bash
pnpm run cli -- treasury-owner compile
```

### 2) Deploy treasury-owner + pause-controller

```bash
pnpm run cli -- treasury-owner deploy
```

### 3) Read deployed treasury-owner state

```bash
pnpm run cli -- treasury-owner read-state
```

This output now includes `currentLifecyclePeriod` (current slot, lifecycle id, period name, and period slot range).  
It is computed using current chain slot and `LIFECYCLE_PERIOD_DURATION` (or `--lifecycle-period-duration`).

### 4) (Optional) Fund treasury

Funding roles:

- fee payer / tx sender: `SENDER_PRIVATE_KEY` (or `--sender-private-key`)
- funding account debited by transfer: `FUNDING_PRIVATE_KEY` (or `--funding-private-key`)
- if `FUNDING_PRIVATE_KEY` is omitted, funding account defaults to sender

```bash
pnpm run cli -- treasury-owner fund-treasury \
  --sender-private-key <FEE_PAYER_PRIVATE_KEY> \
  --funding-private-key <FUNDING_ACCOUNT_PRIVATE_KEY> \
  --amount 10000000000
```

## Flow 2: Create Proposal And Cast Vote

### 1) Generate proposal keypair

```bash
pnpm run cli -- generate-keypair --json
```

### 2) Create proposal

`proposal create` only succeeds during the **proposal creation period** for the target lifecycle.

Proposal creation window:

```text
PROPOSAL_CREATION_START =
  TREASURY_DEPLOYED_AT_SLOT
  + (LIFECYCLE_PERIOD_DURATION * 4 * PROPOSAL_LIFECYCLE_ID)

PROPOSAL_CREATION_END =
  PROPOSAL_CREATION_START + LIFECYCLE_PERIOD_DURATION
```

Run `proposal create` only when current slot is in that window. If you are outside it, the transaction fails the on-chain lifecycle period check.

```bash
pnpm run cli -- proposal create \
  --proposal-private-key <PROPOSAL_PRIVATE_KEY> \
  --proposal-lifecycle-id 0 \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount 1000000000 \
  --proposal-zkapp-uri "https://example.com/proposals/demo"
```

### 3) Read proposal state

```bash
pnpm run cli -- proposal read-state \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY>
```

### 4) Wait for voting window

Voting starts at:

```text
TREASURY_DEPLOYED_AT_SLOT
+ (LIFECYCLE_PERIOD_DURATION * 4 * PROPOSAL_LIFECYCLE_ID)
+ (LIFECYCLE_PERIOD_DURATION * 2)
```

If you are waiting for a period transition, run `pnpm run cli -- treasury-owner read-state` and watch `currentLifecyclePeriod`.

### 5) Cast vote

```bash
pnpm run cli -- proposal vote \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --voter-private-key <VOTER_PRIVATE_KEY> \
  --vote yay \
  --wait true
```

## Flow 3: Tally Votes And Execute

`proposal tally-votes` requires two proofs:

- merged vote-reducer proof
- exhausted staking-ledger-to-voting-ledger proof

### 1) Fetch proposal actions

```bash
pnpm run cli -- proposal fetch-actions \
  --archive-node-url "$ARCHIVE_NODE_URL" \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --output-path ./apps/cli/artifacts/vote-actions.json
```

### 2) Build vote-reducer proof

```bash
pnpm run cli -- vote-reducer compile

pnpm run cli -- vote-reducer trace-run-batch \
  --lifecycle-id 0 \
  --vote-actions-path ./apps/cli/artifacts/vote-actions.json
```

If you need to re-run vote-reducer from a clean state for the same lifecycle, clear
vote-reducer-only dependencies (run-batch traces, reducer proofs, and nullifier ledger)
without removing staking-ledger-to-voting-ledger outputs:

```bash
pnpm run cli -- vote-reducer clear-state \
  --lifecycle-id 0
```

Start Redis:

```bash
docker run --rm -p 6379:6379 redis:7-alpine
```

You can also use an external Redis instance instead of local Docker.  
If so, use that external host/port for every `--redis-host` / `--redis-port` flag below.

Start worker for vote-reducer queue:

```bash
pnpm run cli -- worker start \
  --queue-name vote-reducer-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Workers do not need to run on the same machine as the CLI commands.  
You can run workers externally (or multiple workers across machines) as long as they share the same Redis and queue name.

Then prove and merge:

```bash
pnpm run cli -- vote-reducer prove-run-batch \
  --lifecycle-id 0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --queue-name vote-reducer-0

pnpm run cli -- vote-reducer prove-merge \
  --lifecycle-id 0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --queue-name vote-reducer-0 \
  --proof-output-path ./apps/cli/artifacts/vote-reducer-merge.json
```

### 3) Build staking-ledger-to-voting-ledger exhausted proof

Hydrate staking ledger:

```bash
pnpm run cli -- staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path <PATH_TO_STAKING_LEDGER_JSON>
```

Compile and trace:

```bash
pnpm run cli -- staking-ledger-to-voting-ledger compile

pnpm run cli -- staking-ledger-to-voting-ledger trace-digest \
  --lifecycle-id 0
```

Start worker for staking-ledger queue:

```bash
pnpm run cli -- worker start \
  --queue-name staking-ledger-to-voting-ledger-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Same pattern applies here: workers can run on one machine or many machines, against the same external Redis and queue.

Then prove and exhaust:

```bash
pnpm run cli -- staking-ledger-to-voting-ledger prove-digest \
  --lifecycle-id 0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --queue-name staking-ledger-to-voting-ledger-0

pnpm run cli -- staking-ledger-to-voting-ledger prove-merge \
  --lifecycle-id 0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --queue-name staking-ledger-to-voting-ledger-0 \
  --proof-output-path ./apps/cli/artifacts/staking-ledger-merge.json

pnpm run cli -- staking-ledger-to-voting-ledger prove-exhaust \
  --lifecycle-id 0 \
  --proof-output-path ./apps/cli/artifacts/exhausted-proof.json
```

### 4) Tally votes

```bash
pnpm run cli -- proposal tally-votes \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --vote-reducer-proof-path ./apps/cli/artifacts/vote-reducer-merge.json \
  --staking-ledger-to-voting-ledger-proof-path ./apps/cli/artifacts/exhausted-proof.json \
  --lifecycle-id 0 \
  --wait true
```

### 5) Execute approved proposal payout

Full remaining payout:

```bash
pnpm run cli -- proposal execute \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --wait true
```

Partial payout:

```bash
pnpm run cli -- proposal execute \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount-to-pay-out 500000000 \
  --wait true
```

## Flow 4: Pause Controller And External Signature Exchange

Pause-controller action commands require externally supplied signatures.

### 1) Read current pause-controller state (get nonce + commitment)

```bash
pnpm run cli -- pause-controller read-state \
  --pause-controller-public-key <PAUSE_CONTROLLER_PUBLIC_KEY>
```

### 2) Build signatures for an action

Example: pause treasury.

```bash
pnpm run cli -- multisig-sign pause-treasury \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --multisig-signer-private-key <PRIV1> \
  --nonce <PAUSE_CONTROLLER_NONCE>
```

Run the same command once per signer (same participant list, same nonce, different signer key).

The JSON output contains:

- `type`
- `nonce`
- `dataHash`
- `multisigParticipantsPublicKeys`
- `signerPublicKey`
- `signerParticipantIndex`
- `signature`

### 3) Exchange signatures with other operators

Share these values with other signers/coordinators:

- action `type`
- `nonce`
- participant list **in exact order**
- `dataHash`
- per-signer `signerParticipantIndex` + `signature`

Then compose one final `--multisig-signatures` list by participant index and submit it to pause-controller commands.
You need at least 3 valid signatures in the final list.

### 4) Submit signed action

```bash
pnpm run cli -- pause-controller pause-treasury \
  --pause-controller-public-key <PAUSE_CONTROLLER_PUBLIC_KEY> \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --multisig-signatures <SIG1>,<SIG2>,<SIG3>,<SIG4>,<SIG5> \
  --sender-private-key <SENDER_PRIVATE_KEY> \
  --wait true
```

Other supported actions:

- `pause-controller unpause-treasury`
- `pause-controller toggle-pause-proposal`
- `pause-controller rotate-multisig-keys`

For every action, use matching `multisig-sign <action>` first.

## SQLite Storage

Local state is stored per lifecycle:

- default directory: `./.data/sqlite` (relative to `apps/cli`)
- default file: `./.data/sqlite/<lifecycleId>.sqlite`
- override dir: `SQLITE_DATA_DIRECTORY=/absolute/path/to/sqlite-dir`

Clear one lifecycle DB:

```bash
rm -f ./apps/cli/.data/sqlite/0.sqlite
```

Clear all CLI SQLite DBs:

```bash
rm -rf ./apps/cli/.data/sqlite
```

## Command Discovery

```bash
pnpm run cli -- --help
pnpm run cli -- treasury-owner --help
pnpm run cli -- proposal --help
pnpm run cli -- pause-controller --help
pnpm run cli -- multisig-sign --help
pnpm run cli -- vote-reducer --help
pnpm run cli -- staking-ledger --help
pnpm run cli -- staking-ledger-to-voting-ledger --help
pnpm run cli -- worker --help
```
