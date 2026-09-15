---
title: Web Application
sidebar_label: Web application
audience: developer
page_kind: concept
---

# Web Application

`apps/web` brings participant workflows into one client-side Next.js
application. Shared `@repo/ui` components connect to Treasury data, wallets,
and browser proof work here.

## Runtime Responsibilities

The web application:

- reads Treasury state from Mina GraphQL;
- reads proposal data from the App and Processor APIs;
- manages wallet, search, settings, lifecycle, and error state;
- creates proposal, vote, and execution transactions;
- builds supported proofs in the browser;
- polls Mina state for updates.

It does not run server actions or the indexer and processor workers.

## Source Layout

| Area                  | Path                                |
| --------------------- | ----------------------------------- |
| Routes and layout     | `apps/web/app/`                     |
| Domain features       | `apps/web/features/`                |
| Shared components     | `packages/ui/src/`                  |
| Runtime configuration | `apps/web/features/runtime-config/` |
| Ledger integration    | `apps/web/features/ledger/`         |

## Run The Application

```bash
pnpm --dir apps/web run dev
```

The default URL is `http://127.0.0.1:3100`. Real data needs Mina, Archive,
Postgres, API workers, and all three API surfaces.

Use [Environment configuration](../local-development/environment.md) for direct
and Compose URLs.

## Wallet And Ledger Boundary

The shared wallet controller hides Auro and Ledger differences from feature
code. Ledger transport code stays in the browser feature.

Call WebHID operations only from a user action. The browser does not scan
Ledger account indices.

Ledger requires WebHID in a secure Chromium context. It also requires Mina app
version `1.6.7` or newer with blind signing enabled.

The main web application does not pass `NEXT_PUBLIC_NETWORK_ID` to Auro. The
user must select the same Mina network in Auro and the web application.

Use [Signing with Ledger and
Auro](/learn/signing-with-ledger-and-auro) for supported operations and user
procedures.

## Transaction Submission

Each supported operation builds and proves its transaction in a browser worker.
The selected wallet provider signs the prepared transaction. The application
then submits the signed command to the configured Mina GraphQL endpoint.

The application polls the configured Mina node for inclusion. Proposal creation
uploads the Markdown content after inclusion.

The transaction summary does not show all zkApp account updates. It is not a
complete view of the prepared zkApp transaction.

## Shared UI

`@repo/ui` owns reusable presentation and wallet components. App-specific data
fetching and Zustand stores stay in `apps/web`.

Use Storybook for shared component development:

```bash
pnpm --dir packages/ui run storybook
```

## Tests

```bash
pnpm --dir apps/web run check-types
pnpm --dir apps/web run lint
pnpm --dir apps/web run test
pnpm --dir packages/ui run test
```

Read the [User web guide](../../learn/web-app.md) for visible behavior.

## Sources

- `apps/web/README.md`
- `apps/web/package.json`
- `apps/web/features/ledger/README.md`
- `packages/ui/README.md`
- `packages/ui/package.json`
