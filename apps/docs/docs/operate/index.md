---
title: Operate the Treasury
sidebar_label: Operator overview
slug: /operate/
audience: operator
page_kind: navigation
---

# Operate the Treasury

One operator runs the treasury infrastructure. Five ordered break-glass
signers authorize urgent actions. A signer does not need infrastructure access.

Use this section to provision infrastructure, deploy the contracts, run a
lifecycle, create proofs, and respond to failures.

## Start Here

1. Complete the [CLI prerequisites](cli/prerequisites.md).
2. Open the [operator checklist](operator-checklist.md). Use it during the
   remaining steps.
3. Select an infrastructure path. For Kubernetes, start with the
   [infrastructure runbooks](infrastructure/index.md) and complete the Network
   procedures. For Compose, use the
   [service procedures](services/service-operations.md).
4. Complete [Configure the Treasury](lifecycle/configure-the-treasury.md).
5. Complete [Deploy the Treasury](deployment/deploy-the-treasury.md). The
   Kubernetes command sequence is in
   [2b. Deploy Contracts](infrastructure/deploy-contracts.md).
6. For Kubernetes, deploy the application stack with
   [2c. Deploy Stack](infrastructure/deploy-stack.md).
7. Run the [ideal lifecycle](lifecycle/ideal-lifecycle.md).

The configuration procedure selects values and generates the environment
family. The deployment procedure compiles the release, deploys the contracts,
and reconciles Mina state.

The infrastructure runbooks own Kubernetes commands and environment-specific
Helm values. They do not select Treasury policy.

## Routine Work

- [CLI command index](reference/cli-commands.md)
- [Infrastructure runbooks](infrastructure/index.md)
- [Ledgers and proving](proving/ledgers-and-proving.md)
- [Break-glass operation](break-glass/index.md)
- [Failures and remedies](failures/index.md)

The architecture, service procedures, API reference, and technical reference
are separate Operator sections.
