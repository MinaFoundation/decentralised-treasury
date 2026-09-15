---
title: Operator Quickstart
sidebar_label: Quickstart
audience: operator
page_kind: quickstart
---

# Operator Quickstart

This page gives you the shortest supported path from a prepared host to an
observable Treasury lifecycle. It points to the controlled procedures instead
of copying their commands.

At the end, the contracts are reconciled, the services report progress, and
you can follow the first lifecycle. This page is not an incident procedure.

## 1. Prepare The Host

Complete the [CLI prerequisites](cli/prerequisites.md). Confirm the pinned
Node.js and pnpm versions before you generate configuration or compile a
contract.

Confirm that the host can reach the selected Mina and Archive endpoints. Make
sure that both endpoints contain data for the same Mina network.

## 2. Select The Live Network Services

Select one source for Mina, Archive, and staking-ledger snapshots:

| Network-service source   | Continue with                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------- |
| Managed live services    | Record the approved Mina, Archive, and snapshot-provider endpoints.                     |
| Self-operated Kubernetes | Complete the Network section in the [infrastructure runbooks](infrastructure/index.md). |

Do not use the o1js simulator, Mina-repository single node, or Docker Lightnet
for this operator flow. Those three networks are for development.

## 3. Select The Application Deployment

| Application target            | Continue with                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| One long-running Compose host | [Run Compose on a live testnet](deployment/compose-testnet.md)                           |
| Kubernetes cluster            | Complete the Treasury section in the [infrastructure runbooks](infrastructure/index.md). |

The Compose stack does not start Mina, Archive, or a snapshot exporter. The
Kubernetes runbooks can operate those network services and the application
stack as separate releases.

## 4. Configure The Treasury

Open the [operator checklist](operator-checklist.md). Then complete
[Configure the Treasury](lifecycle/configure-the-treasury.md).

This stage selects the network, lifecycle duration, deployment slot,
verification keys, contract keys, service endpoints, and break-glass keys. Use
one generated environment family for all later stages.

Stop if two consumers resolve different lifecycle values, contract addresses,
network IDs, or verification keys.

Read the [signing support matrix](/learn/signing-with-ledger-and-auro) before
you select a Ledger, Auro, or CLI signing procedure.

## 5. Deploy And Reconcile The Contracts

Complete [Deploy the Treasury](deployment/deploy-the-treasury.md). For
Kubernetes, use [Deploy Contracts](infrastructure/deploy-contracts.md) for the
cluster command sequence.

Do not continue only because the deployment command printed an address. Read
the Treasury Owner and Pause Controller state from Mina. Compare the deployed
values with the selected configuration.

## 6. Start The Application Services

For Compose, complete [Check and start
Compose](deployment/compose-testnet.md#5-check-and-start-compose). For
Kubernetes, complete [Deploy Stack](infrastructure/deploy-stack.md).

Check more than process health:

- the Archive head advances;
- the indexer cursor advances toward that head;
- the processor offset advances toward the indexer;
- the App API returns the configured Treasury;
- the web application uses the same network and Owner address.

## 7. Prepare The First Lifecycle

Before proposal creation, confirm that the exact required staking-ledger
snapshot is available. It must include the default-token Treasury Owner
account with a nonzero balance.

For Compose, publish the exact hash-named JSON and lifecycle pointer in
[Prepare every staking snapshot](deployment/compose-testnet.md#4-prepare-every-staking-snapshot).

Run the [ideal lifecycle](lifecycle/ideal-lifecycle.md). The flow connects
proposal creation, snapshot preservation, votes, both proof programs, tally,
and later execution.

For Kubernetes, the [Lifecycle Pipeline](infrastructure/lifecycle-pipeline.md)
supplies the snapshot, tracing, proving, and tally sequence.

## 8. Confirm The End State

The quickstart is complete when all applicable statements are true:

- Mina stores the expected Treasury contract configuration.
- The Archive, indexer, and processor report current progress.
- The API and web application show the configured Treasury.
- The required snapshot can be tied to its ledger root.
- Proof workers can use the same lifecycle data.
- You can identify the current period from Mina's global slot.

If a statement does not hold, stop at that boundary. Use
[State and reconciliation](foundations/state-and-reconciliation.md) to select
the first direct check. Then use [Failures and remedies](failures/index.md) for
the applicable recovery procedure.

## Sources

- `README.md`
- `devops/README.md`
- `devops/compose.yml`
- `devops/runbooks/`
- `apps/cli/README.md`
- `apps/api/README.md`
