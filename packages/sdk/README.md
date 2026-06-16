# @repo/sdk

Core treasury SDK used by the CLI, indexer/processor wiring, and worker flows.

## What Is Included

- on-chain zkApps:
  - treasury owner
  - treasury proposal
  - pause controller
- off-chain circuits and ledger conversion helpers
- storage-backed services used by CLI commands
- operator and worker runtime helpers used for proof jobs

## o1js Fork

This package expects the `o1js` fork on:

- `git+https://github.com/maht0rz/o1js.git#feature/mesa-support`

The SDK, API, and CLI workspaces use this branch.

## Useful Scripts

From repo root:

```bash
pnpm --dir packages/sdk run lightnet:start
pnpm --dir packages/sdk run lightnet:explorer
pnpm --dir packages/sdk run test
pnpm --dir packages/sdk run test:all
pnpm --dir packages/sdk run test:proofs-enabled
```

Optional docker helpers:

```bash
pnpm --dir packages/sdk run docker:up
pnpm --dir packages/sdk run docker:down
```

## Testing Notes

- tests run with `ts-node/esm`
- proofs-enabled mode is available through `PROOFS_ENABLED=true`
- Lightnet-related tests/scripts assume local Mina/Archive endpoints are reachable

## Related Docs

- [Treasury overview](docs/treasury/index.md) — user-facing entry point for treasury concepts and lifecycle
- [Treasury concepts](docs/treasury/concepts.md) — user-facing explanation of treasury proposals, voting, tallying, execution, and pause controls
- [Proposal lifecycle](docs/treasury/proposal-lifecycle.md) — user-facing proposal journey from creation to payout
- [Voting and results](docs/treasury/voting-and-results.md) — user-facing explanation of voting weight, tallying, and result meaning
- [Provable implementation notes](docs/provable/overview.md) — how SDK provable code, ledgers, tracing, proving, workers, services, and tests fit together

## Specifications

- [Provable primitives](specs/provable/provable-primitives.md) — shared account commitments, hashing, voting-account leaves, and prefixed Merkle witnesses
- [Staking ledger → voting ledger](specs/provable/staking-ledger-to-voting-ledger.md) — ZkProgram that aggregates staking balances into delegate-keyed voting weights (`digest` / `merge` / `exhaust`)
- [Treasury owner](specs/provable/treasury-owner.md) — token-owning treasury coordinator for lifecycle windows, proposal account updates, voting, tallying, and execution
- [Treasury pause controller](specs/provable/treasury-pause-controller.md) — multisig-governed global pause, key rotation, and proposal-pause authorization
- [Treasury proposal](specs/provable/treasury-proposal.md) — proposal-local state, vote action collection, proof-bound tallying, and execution authorization
- [Vote reducer](specs/provable/vote-reducer.md) — ZkProgram that reduces proposal vote actions into weighted yay/nay/abstain totals with nullifiers
