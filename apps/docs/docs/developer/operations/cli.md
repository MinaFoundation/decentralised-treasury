---
title: CLI Operations
sidebar_label: CLI Operations
---

The CLI is the main operator control surface.

## Main Workflows

- compile and deploy treasury contracts,
- fund the treasury,
- create proposals and vote,
- hydrate staking ledgers,
- trace and prove staking-ledger-to-voting-ledger proofs,
- trace and prove vote-reducer proofs,
- tally votes and execute payouts,
- sign and submit pause-controller multisig actions.

## Safety Notes

The current CLI passes private keys through flags or environment variables. Treat it as a development/operator tool and do not use production funds or production keys without a hardened key-management process.

## Source Material

- `apps/cli/README.md`
- `apps/cli/src/commands/`
- `apps/cli/test/`
