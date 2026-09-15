---
title: Developer Environment Configuration
sidebar_label: Environment configuration
audience: developer
page_kind: reference
---

# Developer Environment Configuration

Each environment family describes one target and one way of reaching its
services. Select the family first, then keep all related processes on that
family. Values from different families can point parts of the stack at
different systems.

## Environment Families

The environment generator supports two families:

| Family                  | Use                                                            |
| ----------------------- | -------------------------------------------------------------- |
| `.env.local-blockchain` | In-repository o1js simulator and its application configuration |
| `.env.testnet`          | Mina endpoints, including the Mina-repository single node      |

There is no generated `.env.dev` family.
For native processes, load one generated family and override its Docker URLs with direct host URLs.

Lightnet tests use their command defaults or explicit endpoint options.
They do not require a separate generated environment family.

Create the simulator family:

```bash
pnpm env:bootstrap local-blockchain
```

The command creates these ignored files:

```text
devops/.env.local-blockchain
apps/api/.env.local-blockchain
apps/backoffice/.env.local-blockchain
apps/cli/.env.local-blockchain
apps/web/.env.local-blockchain
packages/local-blockchain/.env.local-blockchain
```

Rerunning the command preserves keys and browser proof values. Use fresh keys
only when you also create a matching deployment and staking snapshot.

Use the same signature network and proof mode in every generated consumer:

```bash
pnpm env:bootstrap <FAMILY> -- \
  --network-id <mainnet|devnet|testnet> \
  --proofs-enabled <true|false>
```

The simulator family uses `devnet` signatures by default. This value does not
connect the simulator to the public Devnet. Endpoint options select the
network services. Use `--mina-node-url`, `--archive-node-url`,
`--compose-mina-node-upstream`, and `--compose-archive-node-url` when the
defaults are not correct for the selected host.

The Mina single-node procedure generates the `testnet` family with its funded whale key.
See [Mina single node](mina-single-node.md) for that procedure.

Generating the `testnet` family does not start Docker Compose.
The Compose live-testnet stack is an [Operator deployment](../../operate/index.md).

## Configuration Groups

| Group        | Main fields                                   | Consumers                         |
| ------------ | --------------------------------------------- | --------------------------------- |
| Mina         | `MINA_NODE_URL`, `MINA_NETWORK_ID`            | CLI, web, Backoffice              |
| Archive      | `ARCHIVE_NODE_URL`                            | Indexer and action fetches        |
| Treasury     | Treasury Owner and Pause Controller addresses | CLI, API, browser apps            |
| Lifecycle    | Deployment slot and period duration           | Contracts, CLI, API, browser apps |
| Database     | `DATABASE_URL`, schema, polling values        | API processes                     |
| SQLite       | `SQLITE_DATA_DIRECTORY`                       | API, CLI, proof services          |
| Proof jobs   | `PROOFS_ENABLED`, Redis and task values       | CLI, schedulers, workers          |
| Browser APIs | `NEXT_PUBLIC_*_URL` values                    | Web and Backoffice builds         |

Use the [environment field index](../../operate/reference/environment-fields.md)
for the complete field list.

## Direct And Compose URLs

Package-direct processes use API ports `4000`, `4001`, and `4002`. The Compose
demo exposes Caddy proxy ports `4100`, `4101`, and `4102`.

The browser must use host-reachable URLs. A container must use a Docker network
name or `host.docker.internal` for a host process.

Do not use a browser URL as a container upstream. Do not use a Docker service
name in browser configuration.

Use these direct network endpoints for native development:

| Network mode                     | Mina GraphQL                    | Archive                         |
| -------------------------------- | ------------------------------- | ------------------------------- |
| In-repository o1js simulator     | `http://127.0.0.1:8080/graphql` | `http://127.0.0.1:8282/graphql` |
| Mina-repository single node      | `http://127.0.0.1:3001/graphql` | `http://127.0.0.1:8282`         |
| Docker Lightnet integration test | `http://127.0.0.1:8080/graphql` | `http://127.0.0.1:8282`         |

The o1js simulator and Lightnet conflict on port `8080`.
All three modes can conflict on Archive port `8282`.
See [Development Network Modes](network-modes.md) before you start a network.

## Shared SQLite Directory

CLI and API processes must resolve the same absolute directory. Export it in
each package-direct terminal:

```bash
export SQLITE_DATA_DIRECTORY="$PWD/.data/native/sqlite"
mkdir -p "$SQLITE_DATA_DIRECTORY"
```

The local Compose demo mounts `.data/local-blockchain-sqlite` into its API
containers.

## Browser Proof Values

The web and Backoffice applications need verification keys and empty ledger
roots for browser proving. Compile the Treasury Owner and copy the emitted
`browserEnv` values into both browser environments when required.

For native development, restart the affected browser development server after
you change a `NEXT_PUBLIC_*` value. A static browser build needs a rebuild.
Compose injects these values at container start, so recreate the affected
service without rebuilding its image.

## Apply A Configuration Change

| Changed value or context                                 | Required action                                                                                              | Check                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Native `next dev` environment                            | Restart the affected development server and reload the page.                                                 | Compare the displayed network, endpoint, and Owner address.                                        |
| Container browser runtime value                          | Recreate the affected container with the new environment, then reload the page. The image can stay the same. | Inspect the injected public configuration and clear a conflicting browser-local endpoint override. |
| Value embedded in a static browser build                 | Rebuild and serve the new output, then reload the page.                                                      | Confirm that the old output is no longer served.                                                   |
| Application source or dependency                         | Build the changed application image.                                                                         | Confirm the release identity and relevant application behavior.                                    |
| Circuit constant, contract duration, or proof dependency | Compile the full dependency chain. Use new contract accounts when the deployed code must change.             | Match the deployment record, verification keys, duration, and both empty roots.                    |
| Browser proof values copied from a compile result        | Apply the matching set through the relevant native or container action above.                                | Confirm that the set belongs to the deployed release before signing.                               |

Changing an endpoint alone does not require new contract verification keys.
Changing a browser duration does not change the duration embedded in a deployed contract.
See [Container images](../operations/container-images.md#browser-runtime-configuration) for the runtime injection mechanism.

## Secret Boundary

Do not add a private key to an API, web, Backoffice, or Compose runtime file.
The local CLI file is the only generated family member that needs signing keys.

All generated local files are ignored by Git. Confirm this before you add a
new environment output.

## Sources

- `devops/scripts/bootstrap-env.mjs`
- `devops/.env.local-blockchain.example`
- `devops/.env.testnet.example`
- `apps/api/.env.local-blockchain.example`
- `apps/api/.env.testnet.example`
- `apps/backoffice/.env.local-blockchain.example`
- `apps/cli/.env.local-blockchain.example`
- `apps/cli/.env.testnet.example`
- `apps/web/.env.local-blockchain.example`
- `apps/web/.env.testnet.example`
- `packages/local-blockchain/.env.local-blockchain.example`
- `apps/cli/src/commands/lightnet.ts`
- `apps/api/src/config.ts`
- `devops/compose.yml`
