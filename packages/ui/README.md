# @repo/ui

Shared React UI components used by workspace apps.

## Exports

This package exports TSX modules directly and groups components by domain.

- shadcn-style UI (`src/components/ui`)
  - `@repo/ui/components/ui/button`
  - `@repo/ui/components/ui/badge`
  - `@repo/ui/primitives` re-exports the UI primitives barrel
- Wallet UI
  - `@repo/ui/wallet/wallet-connect-button`
  - `@repo/ui/wallet/wallet-button`
  - `@repo/ui/wallet/wallet-status-badge`
  - `@repo/ui/wallet/wallet-types`
- Treasury UI
  - `@repo/ui/treasury/header/treasury-header`
  - `@repo/ui/treasury-settings-dialog`
  - `@repo/ui/treasury-status-footer`
  - `@repo/ui/treasury-proposals-table`
  - `@repo/ui/treasury-proposal-detail`
  - `@repo/ui/treasury-proposal-creation-form`
  - `@repo/ui/treasury-proposal-search`
  - `@repo/ui/treasury-transaction-flow-dialog`
  - `@repo/ui/treasury-lifecycle-period-info`

Top-level imports are supported for treasury and wallet components:

- `@repo/ui/wallet-connect-button`
- `@repo/ui/wallet-button`
- `@repo/ui/wallet-status-badge`
- `@repo/ui/wallet-types`
- `@repo/ui/treasury-header`
- `@repo/ui/treasury-settings-dialog`
- `@repo/ui/treasury-networks`
- `@repo/ui/treasury-status-footer`

## What Lives Here

This package currently contains:

- wallet connect and wallet account dropdown UI
- treasury header and settings dialog UI
- proposal tables, detail screens, and creation form UI
- lifecycle period and transaction flow UI
- footer/status UI
- shared i18n defaults used by the components

Behavioral notes:

- wallet dropdown copy and display fallbacks are handled here
- loading, missing, and formatted balance states are rendered here
- presentation only lives here; app-specific fetching and Zustand stores live in app packages

## Development

From repo root:

```bash
pnpm --dir packages/ui run check-types
pnpm --dir packages/ui run lint
pnpm --dir packages/ui run test
pnpm --dir packages/ui run storybook
```
