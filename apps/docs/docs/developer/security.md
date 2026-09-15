---
title: Developer Security Boundaries
sidebar_label: Security boundaries
audience: developer
page_kind: concept
---

# Developer Security Boundaries

Local tools make Treasury development easier, but they also remove some of the
controls that protect a deployed system. Know which boundary you are testing
before you trust a local result or reuse a key.

## Keys And Signing

Generated local environment files contain disposable private keys. Keep these
files outside version control.

The CLI can read private keys from options or environment values. Use Ledger
signing and the approved custody process for keys that control real funds.

The Backoffice signing bundle does not contain Ledger indices. Each signer must
verify the operation and participant slot on an independent device.

Use [Signing with Ledger and Auro](/learn/signing-with-ledger-and-auro) for the
complete operation matrix and exact setup procedures.

## Simulator Boundary

The local blockchain implements only the Mina and Archive surfaces used by this
repository. It does not provide full Mina daemon or Lightnet compatibility.

`PROOFS_ENABLED=false` tests state transitions and integration with dummy proof
objects. It does not verify real proof generation or deployed Mina behavior.

## Off-chain Data

Postgres projections, SQLite ledgers, Redis queues, and trace files are
operational inputs. The contracts accept only values that satisfy their checks.

Event type is fixed during indexer ingestion. The processor consumes typed
events and does not repair unresolved event types.

## Browser Boundary

Browser applications use public runtime values. Do not put a private key in a
`NEXT_PUBLIC_*` field.

WebHID requires a secure browser context. A physical Ledger release check is
required because browser automation cannot approve device prompts.

Read [Authority and trust](../operate/architecture/authority-and-trust.md) for
the deployed trust boundaries. Read [Break-glass operation](../operate/break-glass/index.md)
for the controlled emergency procedure.

## Sources

- `apps/cli/README.md`
- `apps/backoffice/README.md`
- `apps/web/features/ledger/README.md`
- `packages/local-blockchain/README.md`
- `packages/indexer/README.md`
- `packages/processor/README.md`
