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

## Ledger Signing

Connect and unlock the Ledger device. Open the Mina app and enable blind
signing. Close Ledger Live before you start the CLI command.

Use a Ledger account as the fee payer and funding account:

```bash
SENDER_PUBLIC_KEY=<LEDGER_PUBLIC_KEY> pnpm run cli -- transfer \
  --signer=ledger \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount <NANOMINA>
```

Set `FUNDING_PUBLIC_KEY` when a different Ledger account funds the transfer.
The CLI finds both public keys in the first 100 Mina accounts on the device.
The CLI does not accept or show a Ledger account index.

Use a Ledger account for a break-glass partial signature:

```bash
LEDGER_SIGNER_PUBLIC_KEY=<PARTICIPANT_PUBLIC_KEY> pnpm run cli -- \
  multisig-sign pause-treasury \
  --signer=ledger \
  --multisig-participants-public-keys <PUB1>,<PUB2>,<PUB3>,<PUB4>,<PUB5> \
  --nonce <PAUSE_CONTROLLER_NONCE>
```

The CLI builds, signs, verifies, and broadcasts a transaction in one command.
The Ledger only signs. The CLI sends the signed transaction to Mina.

Alias (same behavior):

```bash
pnpm run mina-treasury -- <command> <subcommand> [options]
```

Or run directly from this package:

```bash
cd apps/cli
pnpm run mina-treasury -- <command> <subcommand> [options]
```

## Compare Mina And o1js Ledger Hashes

The `mina-ledger-parity` command generates accounts with the OCaml Mina binary.
It hashes the same ledger with Mina and the o1js staking ledger implementation.
The command exits with an error if the Base58 ledger roots differ.
The account count can be any integer from 0 through 100,000.

Add `--check-circuit` to run the staking-to-voting ledger circuit in memory.
This mode uses `Provable.runAndCheck` and the raw circuit method.
It does not compile the ZkProgram.
It does not create or verify a proof.
The check does these operations:

- It supplies the o1js staking root as the circuit public input.
- It requires that this input root equals the OCaml Mina staking root.
- It checks each staking account and Merkle witness in batches of five.
- It compares the circuit voting root with a separate voting-ledger result.
- It checks that the first leaf after the final padded batch is empty.

The circuit check is opt-in because the voting Merkle tree has height 255.
Its cost grows with the account count.
Use small datasets for fast local checks.

The automated circuit suite uses eight deterministic variations.
It hashes every variation with OCaml Mina before it runs the circuit.
It covers partial and exact batches, padded batches, shared and cyclic delegates,
custom tokens with empty delegates, zero and maximum balances, mixed zkApp
state, and real non-empty verification keys from the test ledger.

By default, 50 percent of the accounts contain zkApp state.
The generator adds entropy to these account fields:

- app state and action state
- zkApp version, URI, proved state, and last action slot
- permissions, nonce, receipt chain hash, and voting target
- delegate, token ID, token symbol, and timing fields

The generated zkApp accounts use an absent verification key.
Mina and o1js represent this value with the protocol dummy verification-key hash.

```bash
pnpm run cli -- mina-ledger-parity \
  --account-count 100 \
  --zkapp-percentage 75 \
  --seed test-dataset-001 \
  --mina-binary /absolute/path/to/mina
```

Run the fast no-proof circuit check on a small dataset:

```bash
pnpm run cli -- mina-ledger-parity \
  --account-count 5 \
  --check-circuit \
  --seed circuit-check-001
```

Set `MINA_BINARY` instead of `--mina-binary` if necessary.
The command also detects the sibling `../mina/single-node-devnet/bin/mina` build.

Use these options to control balances and keep the generated ledger:

```bash
pnpm run cli -- mina-ledger-parity \
  --account-count 100 \
  --min-balance 1 \
  --max-balance 100 \
  --ledger-output-path /tmp/mina-test-ledger.json
```

If `--seed` is absent, the command creates and reports a random seed.
The seed controls the enriched fields, but Mina still creates random keypairs.
Keep the ledger file when you must reproduce the complete dataset.

Use a Mina binary whose protocol version matches the o1js implementation.
The Mina binary sets the protocol ledger depth used by the comparison.

For testnet and demo operator flows, prefer the generated env families from
`devops/TESTNET.md` or `DEMO.md`, for example:

```bash
dotenvx run -f apps/cli/.env.testnet -- pnpm run cli -- --help
dotenvx run -f apps/cli/.env.local-blockchain -- pnpm run cli -- --help
```

For the local-blockchain stack env:

```bash
set -a
source apps/cli/.env.local-blockchain
set +a
pnpm --dir apps/cli run dev -- --help
```

## Baseline Configuration For Deployment

Generate required keypairs first (run once per role and save output):

```bash
pnpm run cli -- generate-keypair --json # treasury-owner
pnpm run cli -- generate-keypair --json # pause-controller
```

Create or edit the manual env file:

```bash
cat > apps/cli/.env.local-blockchain <<'EOF'
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
source apps/cli/.env.local-blockchain
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
echo "TREASURY_DEPLOYED_AT_SLOT=$TREASURY_DEPLOYED_AT_SLOT" >> apps/cli/.env.local-blockchain
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

### 5) (Optional) Transfer MINA between accounts

Use the top-level `transfer` command for a plain payment transaction:

```bash
pnpm run cli -- transfer \
  --sender-private-key <FEE_PAYER_PRIVATE_KEY> \
  --funding-private-key <FUNDING_ACCOUNT_PRIVATE_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount 1000000000
```

If `--funding-private-key` is omitted, the funding account defaults to the sender.

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

Input is a markdown file via `--content-file`. The CLI hashes the
entire file contents using browser-compatible `SHA-256` and derives:

`zkAppUri = urn:proposal-content:markdown:sha256:<hex-digest>`

Prefix meaning:

- `urn`: this is a stable identifier string, not a fetchable URL.
- `proposal-content`: domain separator saying this hash commits to proposal body content.
- `markdown`: content format that was hashed.
- `sha256`: hash algorithm used.
- `<hex-digest>`: lowercase hex-encoded SHA-256 digest of the raw markdown file bytes.

This fixed prefix prevents ambiguity and leaves room to add other content formats or algorithms later (for example `...:json:sha256:...`) without collisions.

```bash
pnpm run cli -- proposal create \
  --proposal-private-key <PROPOSAL_PRIVATE_KEY> \
  --proposal-lifecycle-id 0 \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount 1000000000 \
  --content-file ./proposals/demo.md
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
The CLI accepts `3..5` valid signatures and pads trailing entries with empty signatures automatically.
You can preserve positional gaps with empty comma entries, for example:
`<SIG_0>,,<SIG_2>,<SIG_3>` (slot `1` is filled with a dummy signature).

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

`toggle-pause-proposal` is executed through the treasury-owner contract and requires
`--treasury-owner-public-key` (or `TREASURY_OWNER_PUBLIC_KEY` in env) so proposal pause
events are emitted and indexed correctly.

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
pnpm run cli -- mina-ledger-parity --help
pnpm run cli -- worker --help
pnpm run cli -- transfer --help
```
