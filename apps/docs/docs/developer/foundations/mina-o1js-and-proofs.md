---
title: Mina, o1js, And Proofs
sidebar_label: Mina, o1js, and proofs
audience: developer
page_kind: concept
---

# Mina, o1js, And Proofs

Treasury provable code is TypeScript, but it does not behave like ordinary
server TypeScript. o1js turns defined computations into Mina zkApp methods and
zero-knowledge proof programs.

Start with the difference between normal runtime code and provable code.

## Normal Code Runs Off-Chain

CLI commands, APIs, database handlers, schedulers, and browser components run
as normal JavaScript processes. They can read files, call services, use loops
with runtime lengths, and report normal exceptions.

This code can prepare a transaction or proof. It cannot directly change Mina
account state.

## A SmartContract Defines Mina State Rules

An o1js `SmartContract` subclass defines methods that can authorize Mina
account updates. `@state` fields represent contract state. A method reads
state, adds preconditions, verifies signatures or proofs, and describes the
permitted update.

The client first executes the method to build and prove a transaction. A Mina
node later verifies the transaction against current network and account state.
The second check is why a locally built transaction can still fail after the
state changes.

## Provable Values Are Constrained Values

Types such as `Field`, `Bool`, `UInt32`, `UInt64`, and `PublicKey` can appear in
provable computations. Their operations create constraints that a proof must
satisfy.

Do not convert an unconstrained runtime value into a security decision and
assume that the proof checked it. Keep each important relationship inside the
provable computation or bind it through checked public input.

Provable loops and data structures have fixed shapes. This repository uses
fixed batch sizes and Merkle witnesses so that large ledgers can be processed
in bounded proof steps.

## A ZkProgram Proves An Off-Chain Calculation

An o1js `ZkProgram` defines a proof relation outside a Mina account. The
Treasury has two main programs:

- Staking Ledger to Voting Ledger converts account stake into delegate voting
  weights.
- Vote Reducer converts ordered vote actions into weighted totals and
  nullifier state.

Each proof has public inputs and outputs. Private witnesses supply the detailed
data. The proof says that the program accepted those witnesses for the public
values. A contract can verify the proof without receiving the complete ledger
calculation.

## Compilation Connects The Programs

Compilation produces verification keys. The Proposal configuration includes
the verification keys for both proof programs. The Treasury Owner
configuration includes the Proposal verification key.

Compile order therefore follows the dependency order:

```text
proof programs -> Proposal -> Treasury Owner
```

The CLI, services, contracts, and browser proof code must use matching compile
outputs and empty ledger roots. A stale verification key is a compatibility
error, not a display problem.

## Proof-Disabled And Proof-Enabled Runs Answer Different Questions

Proof-disabled local runs are fast. They are useful for state transitions,
service integration, and user-flow tests. They do not show that real proof
generation fits the configured resources or that every compile artifact is
correct.

Proof-enabled runs compile programs and create real proofs. Use them for
changes to contracts, provable code, public inputs, verification keys, or
proof orchestration.

The local blockchain simulator supplies the Mina and Archive surfaces that the
repository uses. It also gives you explicit slot control, so a test can move
between lifecycle periods without waiting for network time.

## A Practical Reading Order

1. Read the contract method that enforces the final state change.
2. List its state values, preconditions, signatures, and proof inputs.
3. Follow each proof public input back to its ZkProgram output.
4. Follow private witnesses back to snapshot, action, or ledger storage.
5. Check how the CLI or service assembles the transaction.
6. Check both proof-disabled and proof-enabled test coverage.

Continue to [Trace a Treasury change](trace-a-treasury-change.md) for a
complete cross-layer example.

## Sources

- `packages/sdk/src/provable/contracts/`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/provable/merkle-tree/`
- `packages/sdk/src/proving/`
- `packages/local-blockchain/src/o1js.ts`
- `packages/local-blockchain/README.md`
