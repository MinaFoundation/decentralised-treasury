---
title: Local Development Quickstart
sidebar_label: Quickstart
audience: developer
page_kind: quickstart
---

# Local Development Quickstart

This page takes a new checkout to its first useful result. You will install the
toolchain, check the workspace, and select one local run path. You do not need
to understand every service before you start.

## Install The Toolchain

Run these commands from the repository root:

```bash
nvm install
nvm use
corepack enable
node --version
pnpm --version
CI=true pnpm install --frozen-lockfile
```

The repository pins Node.js in `.nvmrc` and pnpm in `package.json`.

## Install The Command Tools

Complete [Required command tools](tools.md) before starting a local process.
It supplies `dotenvx`, `curl`, `jq`, and OpenSSL setup and command checks.
Start Docker before the Compose integration check.

## Check The Workspace

```bash
pnpm check-types
```

Use a package-specific type check when you do not need a workspace check.

## Select A Run Path

Select the [development network mode](network-modes.md) before you start an application layout.

| Goal                                               | Procedure                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| Run the complete proof-enabled simulator lifecycle | [Full local blockchain demo](full-local-demo.md)                          |
| Develop against the in-repository o1js simulator   | [Local blockchain](local-blockchain.md)                                   |
| Develop against a Mina-repository single node      | [Mina single node](mina-single-node.md)                                   |
| Run Docker-based Mina integration tests            | [Lightnet](lightnet.md)                                                   |
| Run packages in separate host processes            | [Native development stack](native-stack.md)                               |
| Check the Compose application pipeline             | [Testing strategy](../testing.md#compose-checks)                          |
| Run a live-testnet Compose deployment              | [Compose operator procedure](../../operate/deployment/compose-testnet.md) |

The complete local demo uses Docker Compose for the application stack.
The o1js simulator and proof worker run as host processes.

The native path is an application process layout.
It can use direct host endpoints from the selected network mode.

Docker Compose does not define a fourth development network.
The live-testnet Compose family is an Operator deployment.

## Start The Simulator Path

Complete this section only when you selected the in-repository simulator or
the full local blockchain demo. The Mina single-node and Lightnet procedures
create their own network settings.

```bash
pnpm env:bootstrap local-blockchain
```

This command creates package-specific local files. The files contain generated
development keys and must stay outside version control.

Read [Environment configuration](environment.md) before you mix Compose and
package-direct processes.

## Run A Fast Integration Check

```bash
pnpm compose:e2e
```

This command starts and stops its own isolated simulator. It does not need the
preceding environment bootstrap. It checks the application pipeline through
proposal creation. It does not vote, tally, execute, or generate real proofs.

If you selected the simulator, run its automated proof-disabled Treasury
lifecycle:

```bash
PROOFS_ENABLED=false pnpm --dir packages/local-blockchain run test
```

## Next Steps

- Read the [system architecture](../architecture/system-overview.md).
- Use the [package reference](../reference/packages.md).
- Use the [testing strategy](../testing.md) before you submit a change.

## Sources

- `README.md`
- `package.json`
- `.nvmrc`
- `DEMO.md`
- `devops/README.md`
- `devops/TESTNET.md`
- `devops/TESTNET_MINA_NODE.md`
- `packages/sdk/package.json`
- `packages/local-blockchain/README.md`
