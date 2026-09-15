---
title: Local Blockchain Simulator
sidebar_label: Local blockchain
audience: developer
page_kind: procedure
---

# Local Blockchain Simulator

When you need fast and repeatable Treasury tests, `@repo/local-blockchain`
stands in for the Mina and Archive surfaces that this repository uses. It also
lets you move the global slot without waiting for real network time.

## Responsibilities

The simulator:

- accepts `sendZkapp` submissions on Mina GraphQL;
- serves the Mina queries used by this repository;
- serves Archive event and action queries used by the indexer and CLI;
- exposes funded development accounts;
- changes the global slot through admin controls;
- changes the staking snapshot hash and total currency;
- records transaction receipts and local blocks.

It does not implement full Lightnet or Mina daemon compatibility. It does not
create Archive fields that a real Archive service does not return.

## Start The Simulator

Use the generated environment:

```bash
pnpm env:bootstrap local-blockchain
pnpm local-blockchain:start
```

The standard surfaces are:

| Surface         | URL                                 |
| --------------- | ----------------------------------- |
| Mina GraphQL    | `http://127.0.0.1:8080/graphql`     |
| Admin UI        | `http://127.0.0.1:8080/admin`       |
| Admin state     | `http://127.0.0.1:8080/admin/state` |
| Health          | `http://127.0.0.1:8080/healthz`     |
| Archive GraphQL | `http://127.0.0.1:8282/graphql`     |

Check the service before you continue:

```bash
curl --fail-with-body http://127.0.0.1:8080/healthz
```

The simulator and all generated clients use the `devnet` signature network.
This value selects the Mina signature domain. It does not connect the
simulator to the public Devnet. The simulator gets its network ID from
`Mina.LocalBlockchain`; the server does not read `MINA_NETWORK_ID` as a
separate network-selection input.

## Admin Controls

The admin UI can set or increment the global slot. It can also set the staking
ledger root field and total currency.

The simulator does not validate that the entered root matches a local JSON
file. The developer must keep the network state, ledger file, SQLite data, and
proof inputs equal.

## Prepare A Development Staking Ledger

Environment bootstrap creates one Treasury Owner key and five voter keys. Use
them to create a matching six-account simulator snapshot:

```bash
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger create-development-snapshot \
  --output-path "$PWD/.data/local-blockchain-ledgers/lifecycle-0.json"
```

The command does not write private keys into the JSON. It prints:

- `ledgerHashBase58` for root verification;
- `stakingEpochDataLedgerHash` for the simulator admin page;
- `stakingEpochDataLedgerTotalCurrency` in nanomina for the simulator admin page.

Open `http://127.0.0.1:8080/admin`. In **Staking Epoch Snapshot**, copy
`stakingEpochDataLedgerHash` into **Staking ledger hash**. Copy
`stakingEpochDataLedgerTotalCurrency` into **Staking ledger total currency**.
Select **Update Network State**. Refresh the page and confirm that both values
remain equal to the command output.

The default Owner balance is `1000` MINA. Each of the five voters has `100`
MINA. The default total is `1500000000000` nanomina. Each amount must be
greater than zero, use at most nine fractional digits, and fit `UInt64` after
conversion to nanomina. The six-account total must also fit `UInt64`.

This JSON is a historical voting snapshot. It does not fund the current
simulator accounts. Fund each key separately before that key must pay a fee or
submit a vote. The [full local demo](full-local-demo.md) includes that funding
procedure.

Import the same file and verify both root formats:

```bash
dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger from-file \
  --lifecycle-id 0 \
  --staking-ledger-path "$PWD/.data/local-blockchain-ledgers/lifecycle-0.json"

dotenvx run -f apps/cli/.env.local-blockchain -- \
  pnpm --dir apps/cli run dev staking-ledger get-root-hash \
  --lifecycle-id 0 \
  --expected-root-hash <LEDGER_HASH_BASE58> \
  --output-format json
```

Use this generated file only with the in-repository simulator. Export the real
ledger when you use Mina single-node, Lightnet, or a live testnet.

## Transaction Behavior

The simulator verifies submitted zkApp transactions through the internal
`Mina.LocalBlockchain` instance. It stores transaction status and Archive data
for accepted submissions.

The `PROOFS_ENABLED` value selects the local proof mode. Proof-disabled mode is
useful for fast state and integration tests.

## Verification

```bash
pnpm --dir packages/local-blockchain run check-types
pnpm --dir packages/local-blockchain run test
```

The suite includes a full proof-disabled Treasury lifecycle. Use the
[full local demo](full-local-demo.md) for the manual proof-enabled flow.

Stop the long-running simulator with `Ctrl+C` in its terminal.

## Sources

- `packages/local-blockchain/README.md`
- `packages/local-blockchain/package.json`
- `packages/local-blockchain/src/server.ts`
- `packages/local-blockchain/src/runtime/local-blockchain-runtime.ts`
- `packages/local-blockchain/src/http/local-blockchain-http-server.ts`
- `packages/local-blockchain/src/archive/archive-http-server.ts`
- `packages/local-blockchain/test/local-blockchain-server.test.ts`
- `apps/cli/src/lib/development-staking-ledger.ts`
