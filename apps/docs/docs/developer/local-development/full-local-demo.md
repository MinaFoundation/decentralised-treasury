---
title: Full Local Blockchain Demo
sidebar_label: Full local blockchain demo
audience: developer
page_kind: procedure
---

<!-- This file is generated. Change DEMO.md or this generator, then run pnpm --dir apps/docs run generate:developer-guides. -->

# Full Local Blockchain Demo

Run this demo when you want to follow one proposal through the full Treasury
lifecycle on your machine. The in-repo blockchain simulator replaces the Mina
daemon, while the package-local environment layout stays close to the real
Mina testnet flow.
For the system concepts, see the
[User documentation](../../learn/index.md). For the controlled
lifecycle, see the [Operator documentation](../../operate/index.md).
For the real Mina testnet path, see the [Compose live-testnet procedure](../../operate/deployment/compose-testnet.md).
For Compose reference material, see the [service procedures](../../operate/services/service-operations.md).

## Scope

By the end of this demo, you will have deployed and funded a local Treasury,
then created, voted on, tallied, and executed one proposal. The flow uses real
proof generation. Its local helper scripts run the application services in
Compose, but they do not create the live-testnet operator deployment.

The repository simulator keeps the run local and repeatable. It provides only
the Mina surfaces that this project needs; it is not a Mina daemon.

## Before You Start

The flow uses several long-running processes and one generated staking snapshot.
Before you start, make sure that you can meet these conditions:

- use the Node.js version in `.nvmrc`;
- enable Corepack and install the locked workspace dependencies;
- start Docker;
- keep at least four terminal sessions available;
- reserve ports `6379`, `8080`, `8282`, `3100`, and `4100` through `4102`;
- reserve a writable `.data/local-blockchain-ledgers` directory.

Run the toolchain setup from the repository root:

```bash
nvm install
nvm use
corepack enable
CI=true pnpm install --frozen-lockfile
```

Complete [Required command tools](tools.md) before the first environment command.
The workspace install does not supply the global environment loader.

## Required Staking Snapshot

Use the repository CLI to create the simulator snapshot after environment
bootstrap. The command reads the generated Treasury Owner and five voter public
keys. It does not write private keys into the snapshot.

The file contains the Treasury Owner account with a nonzero balance. It also
contains five self-delegated voter accounts. Record these values from the
command output:

- the Base58 ledger hash;
- the decimal staking-ledger root field;
- the total default-token currency in nanomina.

Do not continue when the file, root, currency, or generated keys differ. Use
the [automated simulator flow](#automated-simulator-flow) when you do not need
real proofs.

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

Create a development staking snapshot from the generated Treasury Owner and
five voter public keys:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger create-development-snapshot \
  --output-path "$PWD/.data/local-blockchain-ledgers/lifecycle-0.json"
```

This command creates six default-token accounts. The Treasury Owner has a
nonzero historical balance. Each voter has a nonzero self-delegated balance.
The command prints these values:

- `ledgerHashBase58`;
- `stakingEpochDataLedgerHash`;
- `stakingEpochDataLedgerTotalCurrency` in nanomina.

The default Owner balance is `1000` MINA. Each voter has `100` MINA. The
default total is `1500000000000` nanomina.
Both balance options require at least `100` MINA (`100000000000` nanomina).
Snapshot JSON balances use MINA, so a JSON balance of `"100"` means `100` MINA.

Set the matching snapshot values in the admin page:

```text
stakingEpochDataLedgerTotalCurrency=<stakingEpochDataLedgerTotalCurrency>
stakingEpochDataLedgerHash=<stakingEpochDataLedgerHash>
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
  --staking-ledger-path "$PWD/.data/local-blockchain-ledgers/lifecycle-0.json"

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger get-root-hash \
  --lifecycle-id 0 \
  --expected-root-hash <ledgerHashBase58> \
  --output-format json
```

Confirm that the second command prints the same Base58 and decimal hash values.

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
not imported into Auro or Ledger automatically.

Use [Signing with Ledger and
Auro](../../learn/signing-with-ledger-and-auro.md) to prepare the
selected wallet and review the supported operations.

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
`treasury-owner read-state`. Use the web application or the CLI to submit at
least five included vote actions. Five distinct non-initial action-state values
are required by the tally flow. This demo uses five eligible voter keys so each
first action can add voting weight. A CLI vote has this form:

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

For web execution, connect any funded wallet. It does not have to be the
proposal creator. The CLI can also use any valid signed sender. Execute with
the same recipient public key:

```zsh
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev proposal execute \
  --proposal-public-key <PROPOSAL_PUBLIC_KEY> \
  --recipient-public-key <RECIPIENT_PUBLIC_KEY> \
  --wait true
```

Read Proposal state again. Confirm that `paidOutAmount` and the Mina balances
changed by the executed amount.

## Continue With Another Setup

Do not convert this simulator setup by changing only its environment file.
Each network path has different endpoints, accounts, timing, and ledger input.

Use the [Mina single-node procedure](mina-single-node.md) for a local Mina
single-node development network. Use the [Compose live-testnet procedure](../../operate/deployment/compose-testnet.md)
for a long-running Compose host connected to a live testnet.

## Automated Simulator Flow

If you want a faster confidence check before the manual demo, run the automated
Treasury lifecycle. It deploys, funds, creates, votes, tallies, executes,
advances slots, and checks Archive actions.

```bash
PROOFS_ENABLED=false pnpm --dir packages/local-blockchain run test
```

This command explicitly selects `PROOFS_ENABLED=false`. It checks transaction and simulator
integration, but it does not check real proof generation.

The Compose e2e test has a smaller scope:

```bash
pnpm compose:e2e
```

It checks deployment, funding, proposal creation, event ingestion, projection,
API content, and web rendering. It does not vote, tally, or execute.

## Stop Or Reset The Demo

When you finish, stop the Compose services first:

```bash
pnpm local-blockchain:down
```

Stop the local blockchain, Redis, and proof worker with `Ctrl+C` in their
terminals. Use this command only when you also want to remove Compose volumes:

```bash
pnpm local-blockchain:reset
```

The SQLite lifecycle data remains under `.data/local-blockchain-sqlite`.
Remove or archive that directory before you reuse lifecycle `0` with another
staking snapshot.

## Sources

- `DEMO.md`
- `README.md`
- `packages/local-blockchain/README.md`
- `packages/local-blockchain/test/local-blockchain-server.test.ts`
- `devops/test/compose-e2e.mjs`
