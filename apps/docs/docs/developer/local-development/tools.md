---
title: Required Command Tools
sidebar_label: Required tools
audience: developer
page_kind: procedure
---

# Required Command Tools

Install these tools before you follow a local demo or a CLI procedure.
Run repository commands from the checkout root.

## Node.js And Workspace Tools

Install `nvm` with its [official instructions](https://github.com/nvm-sh/nvm#installing-and-updating) if it is unavailable.
Open a new terminal after installation.

```bash
nvm install
nvm use
corepack enable
CI=true pnpm install --frozen-lockfile
```

The `.nvmrc` file selects Node.js. The root `package.json` selects pnpm.

## Environment Loader

The workspace does not install `dotenvx`. The local start script and CLI examples require it on `PATH`.
After `nvm use`, install its global command with npm:

```bash
npm install --global @dotenvx/dotenvx
dotenvx --version
```

This uses the [documented global installation](https://dotenvx.com/docs/learn/installing/#npm-global).
Record the version when you reproduce a run. Switching Node.js installations can require installing the global command again.
Do not use `sudo` with an `nvm`-managed npm installation.

## Shell And Data Tools

The examples use Bash or Zsh, `curl`, `jq`, and OpenSSL.
Install missing tools with the package manager for your machine.

For macOS with Homebrew:

```bash
brew install jq openssl
```

For Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install bash curl jq openssl
```

Check the exact commands before you continue:

```bash
command -v node pnpm dotenvx curl jq openssl
node --version
pnpm --version
dotenvx --version
curl --version
jq --version
openssl version
```

Each command must resolve. `curl` must support `--fail-with-body` for procedures that use that option.
No private key is needed for these checks or for read-only proposal verification.

## Additional Tools By Task

| Task                                     | Additional requirement                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Local application stack or Compose tests | A running Docker engine with `docker compose` support.                                                        |
| Browser E2E tests                        | Chromium installed through the workspace Playwright command. See [Testing](../testing.md#two-pass-local-e2e). |
| Redis worker diagnosis                   | `redis-cli` when the procedure runs it directly on the host.                                                  |
| Ledger signing                           | A compatible device and Mina app. Follow the [signing setup](../../learn/signing-with-ledger-and-auro.md).    |

## Sources

- `.nvmrc` — [nvm installation](https://github.com/nvm-sh/nvm#installing-and-updating)
- `package.json` — [Dotenvx installation](https://dotenvx.com/docs/learn/installing/)
- `apps/cli/package.json`
- `apps/docs/docs/developer/testing.md`
