---
title: Required Command Tools
sidebar_label: Required tools
audience: developer
page_kind: procedure
---

# Required Command Tools

Install these tools before you follow a local demo or a CLI procedure.
Run repository commands from the checkout root.

## Download The Repository

Install Git first. Download the CLI as part of the complete workspace:

```bash
git clone https://github.com/MinaFoundation/decentralised-treasury.git
cd decentralised-treasury
```

For an existing Treasury, get the deployment commit from its operator.
Select that revision before installing dependencies:

```bash
git checkout --detach <DEPLOYMENT_COMMIT>
```

The CLI package is private and uses workspace dependencies.
Run it from this checkout; these instructions do not use a standalone download or global CLI installation.

## Native Dependencies

The examples use Bash or Zsh on macOS or Linux.
SQLite and Ledger packages can require native compilation during installation.
Install the build tools before installing workspace dependencies.

On macOS, install Xcode Command Line Tools if absent, then Python with Homebrew:

```bash
xcode-select --install
brew install python
```

On Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install git build-essential python3 pkg-config libudev-dev libusb-1.0-0-dev
```

See the [node-hid build requirements](https://github.com/node-hid/node-hid#compiling-from-source) for other platforms.
Linux Ledger signing also requires [USB device permissions](https://github.com/node-hid/node-hid#udev-device-permissions).
Follow the [Ledger setup](../../learn/signing-with-ledger-and-auro.md#set-up-ledger-for-the-cli) before signing.

## Node.js And Workspace Tools

Install `nvm` with its [official instructions](https://github.com/nvm-sh/nvm#installing-and-updating) if it is unavailable.
Open a new terminal after installation.

```bash
nvm install
nvm use
corepack enable
node --version
pnpm --version
pnpm install --frozen-lockfile --prod=false
```

This revision pins **Node.js 24.6.0** in `.nvmrc` and **pnpm 9.0.0** in the root `package.json`.
The declared Node.js minimum is `22.19.5`; use the pinned version for these procedures.
For another deployment revision, use that checkout's pins.

Install development dependencies and allow dependency build scripts.
The CLI runs TypeScript through `ts-node`; it does not require `pnpm build`.
Keep the lockfile and the pinned o1js dependency. Do not substitute a registry release.

## Environment Loader

The workspace does not install `dotenvx`. The local start script and CLI examples require it on `PATH`.
After `nvm use`, install its global command with npm:

```bash
npm install --global @dotenvx/dotenvx
dotenvx --version
```

This uses the [documented global installation](https://dotenvx.com/docs/install/).
Record the version when you reproduce a run. Switching Node.js installations can require installing the global command again.
Do not use `sudo` with an `nvm`-managed npm installation.

## Check The CLI

From the repository root:

```bash
pnpm cli --help
pnpm run cli -- proposal download-tally-inputs --help
pnpm run cli -- vote-reducer trace-run-batch --help
```

Each command must exit successfully and print help. These checks need no network, Redis, or Ledger device.
Both command forms run the same CLI. Relative input and output paths use the repository root.
Running `pnpm --dir apps/cli run mina-treasury` instead uses `apps/cli` as the working directory.

Put procedure variables in an environment file, then load it with dotenvx:

```bash
dotenvx run --strict --overload -f .env.tally -- pnpm cli proposal read-state
```

Create `.env.tally` from [Tally Your Proposal](../../learn/tally-a-proposal.md) before running this example.
Keep environment files out of version control. dotenvx does not create missing values.

If installation or startup fails:

| Problem | Action |
| --- | --- |
| Wrong Node.js or pnpm version | Run `nvm use` and `corepack enable` from the checkout root. |
| Missing `ts-node` or native bindings | Install the native build tools, then rerun the full dependency installation above. |
| Missing `/private/tmp/...` package archive | The checkout has a local dependency override. Get a portable revision or the exact artifact from its maintainer. |
| Frozen lockfile mismatch | Use matching manifests and lockfile from the deployment revision. |
| `dotenvx` not found after switching Node.js | Repeat the global dotenvx installation under the selected Node.js version. |

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
| Tally proof generation | Redis and a CLI worker. The [tally guide](../../learn/tally-a-proposal.md) starts Redis through Docker. |
| Browser E2E tests                        | Chromium installed through the workspace Playwright command. See [Testing](../testing.md#two-pass-local-e2e). |
| Redis worker diagnosis                   | `redis-cli` when the procedure runs it directly on the host.                                                  |
| Ledger signing                           | A compatible device and Mina app. Follow the [signing setup](../../learn/signing-with-ledger-and-auro.md).    |

## Sources

- `.nvmrc` — [nvm installation](https://github.com/nvm-sh/nvm#installing-and-updating)
- `package.json` — [Dotenvx installation](https://dotenvx.com/docs/install/)
- `apps/cli/package.json`
- `apps/cli/bin/mina-treasury.cjs`
- `apps/docs/docs/developer/testing.md`
