# Kubernetes Deployment Runbooks

Use these runbooks to deploy the Mina network services and the treasury stack
to Kubernetes. Complete the runbooks in the listed order. Each runbook states
its prerequisites, configuration, checks, and troubleshooting steps.

These runbooks do not describe the Docker Compose deployment. For the Compose
testnet procedure, use [`devops/TESTNET.md`](../TESTNET.md). For the local Mina
daemon and Archive procedure, use
[`devops/TESTNET_MINA_NODE.md`](../TESTNET_MINA_NODE.md).

David Lehuby added the initial runbook set in
[`917ac339`](https://github.com/MinaFoundation/decentralised-treasury/commit/917ac339982cd8470c07b065c1824ac6f57dcdc1).
The files in this directory are the current source for the Kubernetes command
sequence.

## Scope

The runbooks own Kubernetes commands, Helm values, cluster checks, and recovery
commands. They do not select Treasury policy. Select the lifecycle duration,
start slot, acceptance constants, bond constant, permissions, and contract
identities in
[`Configure the Treasury`](../../apps/docs/docs/operate/lifecycle/configure-the-treasury.md)
before you deploy the contracts.

The supplied Helm values contain network, cloud, storage, sizing, and DNS
examples. Replace each marked value and verify each unmarked default for the
target deployment. Render and review the result before you apply it.

## 1. Network Services

1. [1a — Archive Node](1-Network/1a-Archive-Node/README.md) deploys Archive
   Postgres, the Archive process, the guardian, and Archive Node API.
2. [1b — Mina Daemon](1-Network/1b-Mina-Daemon/README.md) deploys the Mina
   daemon and its GraphQL proxy.
3. [1c — Staking Ledger Provider](1-Network/1c-Staking-Ledger-Provider/README.md)
   captures available staking ledgers and serves them to the treasury stack.

## 2. Treasury Services

1. [2a — Generate Treasury Wallet](2-Treasury/2a-Generate-Treasury-Wallet/README.md)
   creates and funds the sender account that pays deployment fees.
2. [2b — Deploy Contracts](2-Treasury/2b-Deploy-Contracts/README.md) prepares the
   environment, compiles the contracts, deploys them, and funds the Treasury
   Owner.
3. [2c — Deploy Stack](2-Treasury/2c-Deploy-Stack/README.md) deploys the treasury
   application and proving services with Helmfile.
4. [2d — Lifecycle Pipeline](2-Treasury/2d-Lifecycle-Pipeline/README.md) explains
   lifecycle artifacts, proving work, recovery, scaling, and checks.

## Configuration Files

The Archive Node, Mina Daemon, Staking Ledger Provider, and treasury stack
directories contain their own `helmfile.yaml`. The treasury stack directory
also contains `verification-keys.yaml`. Review the applicable runbook before
you change or apply one of these files.
