# Mina Decentralized Treasury Demo

This is the guided local demo path. It uses the in-repo local blockchain
simulator plus the same package-local env layout as the real Mina testnet flow.
For the system concepts, see the
[User documentation](apps/docs/docs/learn/index.md). For the controlled
lifecycle, see the [Operator documentation](apps/docs/docs/operate/index.md).
For the real Mina testnet path, see the [testnet runbook](devops/TESTNET.md).
For Compose reference material, see the [DevOps README](devops/README.md).

## 1. Bootstrap Local Env Files

```zsh
pnpm env:bootstrap local-blockchain
```

This writes ignored runtime env files:

```text
devops/.env.local-blockchain
apps/api/.env.local-blockchain
apps/backoffice/.env.local-blockchain
apps/cli/.env.local-blockchain
apps/web/.env.local-blockchain
packages/local-blockchain/.env.local-blockchain
```

Rerunning the command preserves generated keys and browser prover config. Use
`-- --fresh-keys` only when you intentionally want new demo identities. A key
change also requires a new matching local staking ledger.

## 2. Start The Local Blockchain

Run this long-lived process in its own terminal:

```zsh
pnpm local-blockchain:start
```

Open `http://127.0.0.1:8080/admin`. The local blockchain exposes funded test
accounts there. Copy one funded private key into `SENDER_PRIVATE_KEY` in
`apps/cli/.env.local-blockchain` before deploying or funding contracts.

Select one local staking ledger for lifecycle `0`. It must contain these
default-token accounts:

- the configured Treasury Owner public key with a nonzero historical balance;
- each delegate public key that will submit a weighted vote.

Set the matching snapshot values in the admin page:

```text
stakingEpochDataLedgerTotalCurrency=<TOTAL_CURRENCY_NANOMINA>
stakingEpochDataLedgerHash=<STAKING_LEDGER_ROOT_FIELD>
```

The values, the JSON file, the generated identities, and the later proof must
describe the same snapshot. A voter that is absent from this snapshot has zero
voting weight.

## 3. Build Lifecycle Ledger Data

Open a new terminal at the repository root. Use the same absolute SQLite
directory that Compose mounts. Repeat this export in each CLI or worker
terminal:

```zsh
export SQLITE_DATA_DIRECTORY="$PWD/.data/local-blockchain-sqlite"
mkdir -p "$SQLITE_DATA_DIRECTORY"
```

Populate the lifecycle staking ledger SQLite from the selected JSON:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path <LOCAL_STAKING_LEDGER_JSON_PATH>
```

Compile and trace the staking-ledger-to-voting-ledger circuit:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger compile

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger trace-digest \
  --lifecycle-id 0
```

Keep Redis running in another terminal:

```zsh
docker run --rm -p 6379:6379 redis:7-alpine
```

Keep one proof worker running in a third terminal. Set the same SQLite
directory before you start it:

```zsh
export SQLITE_DATA_DIRECTORY="$PWD/.data/local-blockchain-sqlite"

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev worker start \
  --queue-name treasury-demo-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Return to the first CLI terminal. Prove, merge, and exhaust the trace:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger prove-digest \
  --lifecycle-id 0 \
  --queue-name treasury-demo-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger prove-merge \
  --lifecycle-id 0 \
  --proof-output-path .data/local-blockchain-staking-ledger-merge.json \
  --queue-name treasury-demo-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger-to-voting-ledger prove-exhaust \
  --lifecycle-id 0 \
  --proof-output-path .data/local-blockchain-staking-ledger-exhausted.json
```

## 4. Compile Browser Prover Config

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev treasury-owner compile
```

Copy the emitted `browserEnv` values into `apps/web/.env.local-blockchain`.
Future `pnpm env:bootstrap local-blockchain` runs preserve those values.

## 5. Deploy And Fund Treasury

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev treasury-owner deploy

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev treasury-owner fund-treasury \
  --amount 1000000000000
```

## 6. Start The App Stack

```zsh
pnpm local-blockchain:up:build
```

Then open the UI through the proxy:

```text
http://127.0.0.1:3100
```

API endpoints are proxied on:

```text
http://127.0.0.1:4100
http://127.0.0.1:4101
http://127.0.0.1:4102
```

## 7. Create, Vote, Tally, and Execute

The generated demo uses `48` slots for each period. With deployment slot `D`
and lifecycle ID `L`, use these period start slots:

| Period      | Start slot               |
| ----------- | ------------------------ |
| Proposal    | `D + (4 * 48 * L)`       |
| Exploration | `D + (4 * 48 * L) + 48`  |
| Voting      | `D + (4 * 48 * L) + 96`  |
| Cooldown    | `D + (4 * 48 * L) + 144` |
| Next cycle  | `D + (4 * 48 * (L + 1))` |

Set the required slot in `http://127.0.0.1:8080/admin`. Run
`treasury-owner read-state` after each change. Confirm both `lifecycleId` and
`period` before you continue.

Use the web application to create a proposal during the Proposal period. The
wallet must control a funded local account. The generated CLI private keys are
not imported into Auro or Ledger automatically. Keep the proposal-creator
wallet connected for later web execution.

You can instead create the proposal with the CLI:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev proposal create \
  --proposal-lifecycle-id 0 \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --amount 1000000000 \
  --content-file "$PWD/DEMO_PROPOSAL.md" \
  --api-url http://127.0.0.1:4100
```

Save the Proposal address and recipient public key.

To fund a browser proposer or voter account, send local test MINA to its public
key. A generated `VOTER*_PUBLIC_KEY` has voting weight only when the selected
snapshot records it as a delegate:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev transfer \
  --recipient-public-key <VOTER_PUBLIC_KEY> \
  --amount 100000000000
```

Set the simulator to the Voting start slot. Confirm `period=voting` with
`treasury-owner read-state`. Use the web application or the CLI to submit votes
from at least five eligible voter keys. Five non-initial action-state values
are required by the tally flow. A CLI vote has this form:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev proposal vote \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --voter-private-key <VOTER_PRIVATE_KEY> \
  --vote yay \
  --wait true
```

Repeat the vote with the required eligible accounts. Set the simulator to the
Cooldown start slot. Confirm `period=cooldown`. Fetch the actions and build the
Vote Reducer trace:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev proposal fetch-actions \
  --archive-node-url http://127.0.0.1:8282/graphql \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --output-path .data/local-blockchain-vote-actions.json

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev vote-reducer compile

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev vote-reducer trace-run-batch \
  --lifecycle-id 0 \
  --vote-actions-path .data/local-blockchain-vote-actions.json
```

Keep the Redis process and proof worker from step 3 running. Then prove and
merge the reduced votes:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev vote-reducer prove-run-batch \
  --lifecycle-id 0 \
  --queue-name treasury-demo-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev vote-reducer prove-merge \
  --lifecycle-id 0 \
  --queue-name treasury-demo-0 \
  --redis-host 127.0.0.1 \
  --redis-port 6379 \
  --proof-output-path .data/local-blockchain-vote-reducer-merge.json

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev proposal tally-votes \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --vote-reducer-proof-path .data/local-blockchain-vote-reducer-merge.json \
  --staking-ledger-to-voting-ledger-proof-path .data/local-blockchain-staking-ledger-exhausted.json \
  --lifecycle-id 0 \
  --wait true
```

Read Proposal state. Continue only when its status is `APPROVED`. Set the
simulator to the first slot of lifecycle `1`. Confirm `lifecycleId=1` and
`period=proposal`.

For web execution, reconnect the wallet that created the proposal. The CLI can
use any valid signed sender. Execute with the same recipient public key:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev proposal execute \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --wait true
```

Read Proposal state again. Confirm that `paidOutAmount` and the Mina balances
changed by the executed amount.

## Real Mina Testnet Path

For the same treasury flow against a real Mina node on GraphQL `3001` and
archive `8282`, use:

```zsh
pnpm env:bootstrap testnet -- --sender-private-key <FUNDED_TESTNET_PRIVATE_KEY>
pnpm testnet:up:build
```

The detailed real-node setup, staking-ledger export, Archive requirements, and
operator checks are in the [testnet runbook](devops/TESTNET.md) and the
[Mina node runbook](devops/TESTNET_MINA_NODE.md).
