---
title: Infrastructure Runbooks
sidebar_label: Infrastructure runbooks
audience: operator
page_kind: navigation
---

# Infrastructure Runbooks

Use this library to deploy the Mina network services and the treasury stack to
Kubernetes. Complete the procedures in the listed order. Each procedure
contains its prerequisites, configuration, commands, checks, and remedies.

These pages do not replace the files in `devops/runbooks`. Those files are the
source procedures. The documentation generator copies each complete README and
each companion YAML file into this website.

The `devops/runbooks/**` files are the canonical source for Kubernetes
execution. The initial source set came from
[remote `develop` commit `917ac339982cd8470c07b065c1824ac6f57dcdc1`](https://github.com/MinaFoundation/decentralised-treasury/commit/917ac339982cd8470c07b065c1824ac6f57dcdc1).

Use the procedures with the repository and chart revisions that they name. Do
not use an older CLI build for a command that a procedure introduces.

Use [Configure the Treasury](../lifecycle/configure-the-treasury.md) to select
policy values and contract configuration. Use
[Service Procedures](../services/service-operations.md) for Docker Compose.
Use this runbook library for Kubernetes execution.

:::warning Use the source update process

Do not edit a generated procedure page. Change the applicable file in
`devops/runbooks`. Then run:

```bash
pnpm --dir apps/docs run generate:runbooks
```

The documentation check fails if a generated page does not match its source.

:::

## 1. Network

| Order | Procedure                                             | Result                                                                                     |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1a    | [Archive Node](archive-node.md)                       | Archive Postgres, the Archive process, the guardian, and Archive Node API are operational. |
| 1b    | [Mina Daemon](mina-daemon.md)                         | The Mina daemon and its GraphQL proxy are operational.                                     |
| 1c    | [Staking Ledger Provider](staking-ledger-provider.md) | The provider captures and serves staking ledgers.                                          |

## 2. Treasury

| Order | Procedure                                               | Result                                                                                               |
| ----- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 2a    | [Generate Treasury Wallet](generate-treasury-wallet.md) | The deployment sender account exists and has funds for fees.                                         |
| 2b    | [Deploy Contracts](deploy-contracts.md)                 | The environment is ready, the contracts are compiled and deployed, and the Treasury Owner has funds. |
| 2c    | [Deploy Stack](deploy-stack.md)                         | The treasury application and proving services are operational.                                       |
| 2d    | [Lifecycle Pipeline](lifecycle-pipeline.md)             | The operator can observe lifecycle artifacts, proving work, recovery, and scaling.                   |

## Publication Rules

The generated pages use these rules:

- The generator keeps all README sections, commands, tables, warnings, and
  references.
- The generator keeps every line from each companion `.yaml` file.
- Each YAML section has a download of the unchanged source file.
- The generator changes angle-bracket web links to equivalent Markdown links.
  This format-only change lets Docusaurus compile the same link.
- Each page records the source paths and SHA-256 values.

## Scope

These procedures describe the Kubernetes deployment. They do not describe the
Docker Compose deployment.

## Sources

- `devops/runbooks/README.md`
