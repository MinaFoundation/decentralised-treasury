---
title: CLI Development
sidebar_label: CLI development
audience: developer
page_kind: concept
---

# CLI Development

Most protocol work eventually passes through `apps/cli`. It connects contract
commands, proof workflows, ledger tools, signing, and local administration in
one command surface.

## Command Groups

| Group             | Main work                                                         |
| ----------------- | ----------------------------------------------------------------- |
| Treasury Owner    | Compile, deploy, fund, read, and withdraw.                        |
| Proposal          | Create, read, vote, fetch actions, tally, and execute.            |
| Pause Controller  | Read state and submit multisig actions.                           |
| Ledger            | Sign transactions and fields with a physical or simulated device. |
| Staking ledger    | Import Mina JSON and serve lifecycle accounts and witnesses.      |
| Staking-to-voting | Compile, trace, prove, merge, and prove exhaustion.               |
| Vote Reducer      | Compile, trace, prove batches, and merge proofs.                  |
| Worker            | Consume Redis proof tasks.                                        |
| Utility           | Generate keys, transfer MINA, and compare ledger roots.           |

Use the complete [CLI command index](../../operate/reference/cli-commands.md)
for options and environment variables.

## Run Commands

Run a source command during development:

```bash
pnpm --dir apps/cli run dev -- --help
```

Run the packaged root command:

```bash
pnpm run cli -- --help
```

Load one environment family with `dotenvx` before a network command.

## Command Structure

`apps/cli/src/cli.ts` registers command factories from `apps/cli/src/commands`.
Each command can read a Commander option or its mapped environment field.

Keep parsing and validation at the command boundary. Keep reusable contract,
ledger, and proof logic in `@repo/sdk` services.

## Signing

In-memory signing reads keys from options or environment values. Ledger signing
requires explicit public keys and account indices.

The CLI does not support Auro. Use [Signing with Ledger and
Auro](/learn/signing-with-ledger-and-auro) for the supported signing surfaces.
Set the network ID explicitly. The CLI does not derive it from the Mina node
URL.

These 13 commands sign and submit Mina transactions:

- `treasury-owner deploy`;
- `treasury-owner fund-treasury`;
- `treasury-owner emergency-withdraw`;
- `proposal create`;
- `proposal vote`;
- `proposal tally-votes`;
- `proposal execute`;
- `pause-controller deploy`;
- `pause-controller pause-treasury`;
- `pause-controller unpause-treasury`;
- `pause-controller toggle-pause-proposal`;
- `pause-controller rotate-multisig-keys`;
- `transfer`.

The commands do not export signed transactions for offline submission. A
transaction can have multiple signing roles. Each account can require a
different Ledger index. `proposal create` always signs the new Proposal
account with a local private key.

These four commands create one partial field signature and do not submit a
Mina transaction:

- `multisig-sign pause-treasury`;
- `multisig-sign unpause-treasury`;
- `multisig-sign toggle-pause-proposal`;
- `multisig-sign rotate-multisig-keys`.

Deploy and Pause Controller submission commands check that participant lists
contain five keys. They do not enforce unique keys. Operators must confirm
that current and replacement lists contain five unique keys. The
`multisig-sign` parser enforces uniqueness.

Do not log key values. Do not add a signing key to a browser or API environment.

## Storage And Jobs

Lifecycle commands resolve SQLite files from `SQLITE_DATA_DIRECTORY`. Proof
commands use lifecycle IDs and queue names to separate work.

The tracer, prover, merger, and worker must use the same program configuration.
Do not reuse stored work after a relevant circuit change.

## Tests

```bash
pnpm --dir apps/cli run check-types
pnpm --dir apps/cli run test
pnpm --dir apps/cli run test:docs-reference
```

Update the command reference when a `.command(...)` declaration or option
changes. The documentation test checks this relationship.

## Sources

- `apps/cli/README.md`
- `apps/cli/package.json`
- `apps/cli/src/cli.ts`
- `apps/cli/src/commands/`
- `apps/cli/test/`
