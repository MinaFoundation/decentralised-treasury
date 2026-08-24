# @repo/sdk

Core treasury SDK used by the CLI, indexer/processor wiring, and worker flows.

## What Is Included

- provable contracts:
  - treasury owner
  - treasury proposal
  - pause controller
- proof programs and ledger conversion helpers
- service layer used by CLI commands
- worker/runtime helpers used for proof jobs

## o1js Fork

This package expects the `o1js` fork on:

- `git+https://github.com/maht0rz/o1js.git#87bc121acad6ba4d81df499e49ff44800c130ded`

The workspace currently pins SDK/API/CLI to this commit.

## Useful Scripts

From repo root:

```bash
pnpm --dir packages/sdk run lightnet:start
pnpm --dir packages/sdk run lightnet:explorer
pnpm --dir packages/sdk run test
pnpm --dir packages/sdk run test:all
pnpm --dir packages/sdk run test:proofs-enabled
```

Optional docker helpers:

```bash
pnpm --dir packages/sdk run docker:up
pnpm --dir packages/sdk run docker:down
```

## Testing Notes

- tests run with `ts-node/esm`
- proofs-enabled mode is available through `PROOFS_ENABLED=true`
- Lightnet-related tests/scripts assume local Mina/Archive endpoints are reachable

## Related Docs

- CLI operation flows: `apps/cli/README.md`
- API/indexer/processor wiring: `apps/api/README.md`
