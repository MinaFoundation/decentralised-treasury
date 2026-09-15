---
title: Backoffice Application
sidebar_label: Backoffice application
audience: developer
page_kind: concept
---

# Backoffice Application

Break-glass work stays separate from normal proposal governance.
`apps/backoffice` is a dedicated client-side Next.js application for urgent
Pause Controller actions.

## Supported Actions

The application supports exactly four state-changing operations:

- pause the Treasury;
- unpause the Treasury;
- toggle one Proposal pause state;
- rotate the five ordered participant keys.

Each operation needs three valid participant field signatures from five
ordered positions. Operators must configure five unique public keys in their
exact order.

Backoffice creates participant field signatures with Ledger only. The final
transaction fee payer can use Auro or Ledger.

The application also supports:

- browser proof generation;
- signing bundle import, merge, export, and receipts.

## Signer and Submitter Workflow Modes

`Signer` and `Submitter` are interface workflow modes. They are not
authenticated roles or access controls.

The submitter creates one unsigned operation bundle. Each signer imports that
bundle, verifies the operation, signs one participant slot, and returns a
contribution.

The submitter merges compatible contributions. The application rejects another
operation, a conflicting slot, an invalid key, or fewer than three valid
signatures.

Ledger account indices stay in local wallet sessions. They are not part of a
signing bundle.

## Runtime Configuration

The application needs the Mina URL, Treasury Owner address, five unique ordered
participant keys, verification keys, and empty roots. The participant order
must match the on-chain commitment.

The dashboard blocks operations when the configured commitment differs from
the contract state.

## Development

```bash
pnpm --dir apps/backoffice run dev
pnpm --dir apps/backoffice run check-types
pnpm --dir apps/backoffice run test
pnpm --dir apps/backoffice run test:e2e
```

The default URL is `http://127.0.0.1:3200`.

## Long-Running Compose Access

The public HTTPS Compose profile does not expose Backoffice. Connect to the
operator host through an SSH tunnel:

```bash
ssh -N -L 3200:127.0.0.1:3200 <OPERATOR_HOST>
```

Then open `http://127.0.0.1:3200` on the operator workstation. The loopback
origin is a secure browser context for WebHID.

The SSH boundary controls network access to Backoffice. The interface workflow
modes do not authenticate a person.

## Physical Ledger Check

Browser tests mock WebHID. Before a Ledger-related release, verify these items
with a physical device:

1. Connect an account and select its exact participant slot.
2. Review and approve the field signature on the device.
3. Confirm rejection for a key that is not a participant.
4. Review and approve the complete fee-payer transaction.

Use a supported Chromium browser on `localhost` or another secure context.

Read [Signing with Ledger and
Auro](/learn/signing-with-ledger-and-auro) for wallet support, setup, and
approval checks.

Read [Break-glass operation](../../operate/break-glass/index.md) for the operator
procedure and state checks.

## Sources

- `apps/backoffice/README.md`
- `apps/backoffice/package.json`
- `apps/backoffice/features/`
- `apps/web/features/ledger/README.md`
- `devops/compose.yml`
- `devops/proxy/Caddyfile`
- `packages/ui/README.md`
