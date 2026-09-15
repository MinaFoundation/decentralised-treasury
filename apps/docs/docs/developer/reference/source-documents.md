---
title: Repository Markdown Source Map
sidebar_label: Markdown source map
audience: developer
page_kind: reference
---

# Repository Markdown Source Map

Not every Markdown file belongs directly in the public site. Some files become
published pages, some feed a generator, and others stay close to the package
they explain. This map shows where readers can find the public version of each
product document.

## Root Documents

| Source             | Published destination                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`        | [Developer quickstart](../local-development/quickstart.md), [architecture](../architecture/system-overview.md), and [package reference](packages.md). |
| `DEMO.md`          | Generated as the [full local demo](../local-development/full-local-demo.md).                                                                          |
| `DEMO_PROPOSAL.md` | Input file for the full local demo. It is not a procedure.                                                                                            |

## Application Documents

| Source                               | Published destination                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/api/README.md`                 | [API runtime](../apps/api-runtime.md) and [API route map](api-routes.md).                                              |
| `apps/backoffice/README.md`          | [Backoffice application](../apps/backoffice.md).                                                                       |
| `apps/cli/README.md`                 | [CLI development](../operations/cli.md) and the Operator [CLI command index](../../operate/reference/cli-commands.md). |
| `apps/cli/test/ledger/README.md`     | [Testing strategy](../testing.md) and CLI package tests.                                                               |
| `apps/docs/README.md`                | [Documentation development](../documentation.md).                                                                      |
| `apps/web/README.md`                 | [Web application](../apps/web-app.md) and [native stack](../local-development/native-stack.md).                        |
| `apps/web/features/ledger/README.md` | [Web application](../apps/web-app.md) and [security boundaries](../security.md).                                       |

## Package Documents

| Source                                 | Published destination                                                       |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `packages/sdk/README.md`               | [Provable overview](../provable/provable-overview.md).                      |
| `packages/indexer/README.md`           | [Indexer and processor](../apps/indexer-and-processor.md).                  |
| `packages/processor/README.md`         | [Indexer and processor](../apps/indexer-and-processor.md).                  |
| `packages/local-blockchain/README.md`  | [Local blockchain](../local-development/local-blockchain.md).               |
| `packages/ui/README.md`                | [Web application](../apps/web-app.md) and [package reference](packages.md). |
| `packages/eslint-config/README.md`     | [Package reference](packages.md).                                           |
| `packages/typescript-config/README.md` | [Package reference](packages.md).                                           |

## Deployment Documents

| Source                        | Published destination                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devops/README.md`            | Operator [service procedures](../../operate/services/service-operations.md) and Developer [testing](../testing.md).                                       |
| `devops/PUBLISHING.md`        | Developer [container images](../operations/container-images.md) and Operator [service procedures](../../operate/services/service-operations.md).          |
| `devops/TESTNET.md`           | Operator [Compose live-testnet procedure](../../operate/deployment/compose-testnet.md) and [ideal lifecycle](../../operate/lifecycle/ideal-lifecycle.md). |
| `devops/TESTNET_MINA_NODE.md` | Developer [Mina single-node network](../local-development/mina-single-node.md).                                                                           |
| `devops/runbooks/README.md`   | Operator [infrastructure runbooks](../../operate/infrastructure/index.md).                                                                                |

Each `devops/runbooks/*/README.md` is generated into its matching Operator
infrastructure page. The generated page includes the complete source procedure
and companion configuration files.

## Repository-only Markdown

`AGENTS.md`, `.agents/skills`, `.changeset`, and `.codebase-analysis` contain
repository policy, tooling instructions, release metadata, or analysis output.
They are not public product procedures.

Convert applicable facts into a User, Operator, or Developer page. Do not
publish these repository-only files as a fourth documentation audience.

## Maintenance Rule

Add each new product README or runbook to this map. Select one public owner and
link all secondary audiences to that owner.

Do not copy a complete procedure into multiple hand-authored pages. Use a
generator when the published page must contain the complete source document.

## Sources

- `README.md`
- `apps/docs/README.md`
- `apps/docs/scripts/generate-developer-guides.mjs`
- `apps/docs/scripts/generate-infrastructure-runbooks.mjs`
