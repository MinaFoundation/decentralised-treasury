# DevOps Compose Reference

This directory owns the Docker Compose stack and operator support files for the
treasury web/API runtime. It is reference material. For a real testnet run,
start with `devops/TESTNET.md`. For the fastest local simulator walkthrough,
start with `DEMO.md`.

## Which Document To Use

| Goal                                                              | Start here                           |
| ----------------------------------------------------------------- | ------------------------------------ |
| Run the local simulator demo                                      | `DEMO.md`                            |
| Run the treasury stack against a Mina testnet node                | `devops/TESTNET.md`                  |
| Start a local Mina daemon and archive node                        | `devops/TESTNET_MINA_NODE.md`        |
| Inspect Compose services, ports, smoke tests, and troubleshooting | this file                            |
| Develop packages directly on the host                             | package READMEs and `.env.dev` files |

## What Compose Runs

The Compose stack runs the application services only:

- web UI
- app API
- indexer API
- processor API
- indexer runtime
- processor runtime
- Postgres
- one-shot API migration init
- Caddy reverse proxy
- staking-ledger-to-voting-ledger witness tracing (`voting-ledger-scheduler`)

The Compose stack does not run a Mina node or archive node — those run outside
the app stack. Redis and the staking-ledger-to-voting-ledger proof workers
(`redis`, `proving-worker`, `proving-scheduler`) are also outside the default
stack, but available opt-in behind the `proving` Compose profile — see
"Automated Proving" in `devops/TESTNET.md`.

## Security Defaults

The local Compose profile publishes only Caddy proxy ports on the host. App,
API, processor, indexer, and Postgres ports stay private to the Docker network.

Generated env files bind the local proxy to `127.0.0.1` by default:

```text
http://127.0.0.1:3100 -> web
http://127.0.0.1:4100 -> app API
http://127.0.0.1:4101 -> indexer API
http://127.0.0.1:4102 -> processor API
```

The public HTTPS profile is the only profile intended to bind `80` and `443` on
`0.0.0.0`.

## Files In This Directory

| Path                            | Purpose                                                                 |
| ------------------------------- | ----------------------------------------------------------------------- |
| `compose.yml`                   | Main application stack                                                  |
| `TESTNET.md`                    | Primary testnet operator runbook                                        |
| `TESTNET_MINA_NODE.md`          | Local Mina/archive node appendix                                        |
| `.env.testnet.example`          | Generated testnet Compose infrastructure template                       |
| `.env.local-blockchain.example` | Generated simulator Compose infrastructure template                     |
| `.env.compose.example`          | Manual single-file Compose reference; not the recommended operator path |
| `scripts/bootstrap-env.mjs`     | Generates package-local `.env.<family>` files                           |
| `proxy/Caddyfile`               | Local Caddy proxy                                                       |
| `proxy/Caddyfile.https`         | Public HTTPS Caddy proxy                                                |
| `test/`                         | Compose smoke/e2e checks                                                |

## Env Families

Use generated env families for normal operation:

```bash
pnpm testnet:env
pnpm local-blockchain:env
```

The generator writes package-local, ignored files:

```text
devops/.env.<family>
apps/api/.env.<family>
apps/cli/.env.<family>
apps/web/.env.<family>
packages/local-blockchain/.env.local-blockchain
```

Keep Mina private keys in `apps/cli/.env.<family>`. The API, web, and devops env
files should not contain funded Mina private keys.

For the testnet family, endpoint values are split by where they run:

```text
apps/cli/.env.testnet  MINA_NODE_URL=http://127.0.0.1:3001/graphql
apps/cli/.env.testnet  ARCHIVE_NODE_URL=http://127.0.0.1:8282
devops/.env.testnet    MINA_NODE_PROXY_UPSTREAM=http://host.docker.internal:3001
apps/api/.env.testnet  ARCHIVE_NODE_URL=http://host.docker.internal:8282
apps/web/.env.testnet  NEXT_PUBLIC_MINA_NODE_URL=http://127.0.0.1:3100/mina/graphql
```

The CLI uses host-facing URLs. Compose containers use
`host.docker.internal` when the Mina daemon and archive node run on the Docker
host. The browser uses full URLs through the local Caddy web origin.

The `NEXT_PUBLIC_*` values reach the browser at container start rather than
being compiled in, so changing one no longer needs an image rebuild - restart
the web service and the new value is served. See [PUBLISHING.md](PUBLISHING.md)
for the full list and for building images another operator can run.

`.env.compose.example` is kept for manual Compose experiments that use a single
env file. Do not use it as the primary testnet runbook unless you intentionally
want to bypass the generated family env layout.

## Common Commands

Real Mina testnet family:

```bash
pnpm testnet:env
pnpm testnet:build
pnpm testnet:up
pnpm testnet:up:build
pnpm testnet:down
pnpm testnet:reset
pnpm testnet:logs
pnpm testnet:config
```

Add the opt-in `proving` profile (Redis + proving-worker cluster +
proving-scheduler — see "Automated Proving" in `devops/TESTNET.md`):

```bash
pnpm testnet:up:proving
pnpm testnet:up:proving:build
```

Local blockchain simulator family:

```bash
pnpm local-blockchain:env
pnpm local-blockchain:start
pnpm local-blockchain:build
pnpm local-blockchain:up
pnpm local-blockchain:up:build
pnpm local-blockchain:down
pnpm local-blockchain:reset
pnpm local-blockchain:logs
pnpm local-blockchain:config
```

Use one family at a time. Both families publish the same local proxy ports.

## Public HTTPS Proxy

For public HTTPS, set these values in `devops/.env.testnet`:

```env
LETSENCRYPT_EMAIL=ops@example.com
PUBLIC_WEB_DOMAIN=treasury.example.com
PUBLIC_API_DOMAIN=api.treasury.example.com
PUBLIC_INDEXER_DOMAIN=indexer.treasury.example.com
PUBLIC_PROCESSOR_DOMAIN=processor.treasury.example.com
```

Set browser/API origins in `apps/web/.env.testnet` and `apps/api/.env.testnet`.
The web app can stay same-origin through the public web domain:

```env
NEXT_PUBLIC_TREASURY_API_URL=https://treasury.example.com/api
NEXT_PUBLIC_INDEXER_API_URL=https://treasury.example.com/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=https://treasury.example.com/processor
NEXT_PUBLIC_MINA_NODE_URL=https://treasury.example.com/mina/graphql
CORS_ALLOWED_ORIGINS=https://treasury.example.com
```

Then run:

```bash
pnpm testnet:up:public
```

Use the staging CA first if you need a certificate dry run:

```env
LETSENCRYPT_ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
```

## Lifecycle SQLite Data

The API and processor read lifecycle SQLite files from the mounted data
directory. In Compose, the container path is:

```text
/data/sqlite/<lifecycleId>.sqlite
```

The host path comes from `SQLITE_DATA_HOST_PATH` in `devops/.env.<family>`.
The generated defaults are:

```text
../.data/testnet-sqlite
../.data/local-blockchain-sqlite
```

For each lifecycle, the file name must be `<lifecycleId>.sqlite`. If you replace
an existing lifecycle database while services are running, restart `api` and
`processor` so they reopen the SQLite connections:

```bash
docker compose \
  --env-file devops/.env.testnet \
  --env-file apps/api/.env.testnet \
  --env-file apps/web/.env.testnet \
  -f devops/compose.yml \
  --profile proxy \
  restart api processor
```

The detailed ledger export, tracing, proof, and handoff sequence belongs in the
operator flow that needs it. Keep the first stack startup path separate from
proof-worker setup.

## Local Validation

Run the Compose smoke test:

```bash
pnpm compose:test
```

After building once:

```bash
COMPOSE_TEST_NO_BUILD=1 pnpm compose:test
```

Run the fuller local integration e2e:

```bash
pnpm compose:e2e
```

The e2e uses a separate Compose project name. It binds local Mina/archive ports
and Caddy proxy ports, so stop stacks using `8080`, `8282`, `3100`, `4100`,
`4101`, or `4102` first.

Useful flags:

```bash
COMPOSE_E2E_NO_BUILD=1 pnpm compose:e2e
COMPOSE_E2E_SKIP_BROWSER=1 pnpm compose:e2e
COMPOSE_E2E_KEEP_STACK=1 pnpm compose:e2e
COMPOSE_E2E_SKIP_PORT_CHECK=1 pnpm compose:e2e
```

On failure, e2e diagnostics are written under `devops/.data/e2e-artifacts/`.

## Troubleshooting

- If `api-migrate` fails, inspect Postgres env and migration logs.
- If the web UI loads but API calls fail, check that `NEXT_PUBLIC_*` URLs are
  reachable from the browser.
- If indexer `/status` fails, check `ARCHIVE_NODE_URL` from inside the
  container.
- If lifecycle endpoints return `404`, check that `<lifecycleId>.sqlite` exists
  in the mounted SQLite directory.
- If data looks stale after replacing SQLite files, restart `api` and
  `processor`.
- If proof workers do not pick up jobs, check Redis connectivity, queue names,
  and whether workers use the same trace/proof storage as the CLI command that
  queued work.
