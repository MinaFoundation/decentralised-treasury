---
title: Contributing
sidebar_label: Contributing
audience: developer
page_kind: procedure
---

# Contributing

A focused change is easier to understand and verify. Start with the repository
instructions, find the component that owns the behavior, and keep unrelated
work out of the change.

## Prepare The Workspace

```bash
nvm install
nvm use
corepack enable
CI=true pnpm install --frozen-lockfile
```

Create a focused branch or worktree. Check the current worktree before you
edit files. Do not overwrite unrelated changes.

## Find The Owning Component

Use the [package reference](reference/packages.md) and
[system architecture](architecture/system-overview.md). Read the component
README before you change its public interface.

Change all affected layers when a behavior crosses component boundaries. For
example, an event change can affect the contract, indexer, processor, APIs,
web application, tests, and reference pages.

## Implement And Verify

1. Add or update the narrow source test.
2. Run the package type check.
3. Run the narrow test command.
4. Run the applicable integration test.
5. Update the User, Operator, or Developer page for the affected audience.
6. Run the [documentation checks](documentation.md#check-the-documentation).

Use the [testing guide](testing.md) to select the correct command. Real proof
tests can use substantial time and memory.

## Documentation Ownership

User pages describe user decisions and visible results. Operator pages describe
deployed configuration and controlled procedures.

Developer pages describe code, local workflows, and verification. Source
READMEs can keep package-specific detail, but the Developer section must link
to and summarize that detail.

## Sources

- `AGENTS.md`
- `README.md`
- `package.json`
- `apps/docs/README.md`
- `apps/docs/package.json`
