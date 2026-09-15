---
title: Operate the Treasury
sidebar_label: Start here
slug: /operate/
audience: operator
page_kind: navigation
---

# Operate the Treasury

Running the Treasury means keeping Mina state, proof inputs, services, and
public views in agreement. Choose a short path or learn the operating model
before you change a live environment.

## Choose A Path

| If you want to...                            | Start here                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Understand the operator role                 | [Operator overview](overview.md)                                                        |
| Follow the shortest deployment path          | [Operator quickstart](quickstart.md)                                                    |
| Learn what the stack contains                | [What you operate](foundations/what-you-operate.md)                                     |
| Understand lifecycle proof work              | [Lifecycle and proof work](foundations/lifecycle-and-proof-work.md)                     |
| Diagnose disagreement between system layers  | [State and reconciliation](foundations/state-and-reconciliation.md)                     |
| Run one long-lived live-testnet Compose host | [Compose live-testnet stack](deployment/compose-testnet.md)                             |
| Check Ledger and Auro support                | [Signing support matrix](/learn/signing-with-ledger-and-auro)                           |
| Run a production procedure                   | [Operator checklist](operator-checklist.md)                                             |
| Find an exact command or value               | [CLI reference](reference/cli-commands.md) or [technical reference](reference/index.md) |

## Full Operator Path

If this system is new to you, use this order:

1. Read the three foundation pages.
2. Complete the [CLI prerequisites](cli/prerequisites.md).
3. Keep the [operator checklist](operator-checklist.md) open.
4. Select the [Compose live-testnet procedure](deployment/compose-testnet.md)
   or the [Kubernetes runbooks](infrastructure/index.md).
5. [Configure the Treasury](lifecycle/configure-the-treasury.md).
6. Read the [signing support matrix](/learn/signing-with-ledger-and-auro).
7. [Deploy the Treasury](deployment/deploy-the-treasury.md).
8. Run the [ideal lifecycle](lifecycle/ideal-lifecycle.md).
9. Learn the [failure procedures](failures/index.md) before an incident occurs.

Use the [infrastructure runbooks](infrastructure/index.md) for Kubernetes. Use
the [Compose live-testnet procedure](deployment/compose-testnet.md) for one
long-running cloud host. The three Developer network modes are not operator
deployment paths.

## Sources

- `devops/README.md`
- `devops/TESTNET.md`
- `devops/compose.yml`
- `devops/runbooks/`
