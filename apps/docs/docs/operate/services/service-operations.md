---
title: Service Procedures
sidebar_label: Service Procedures
sidebar_position: 3
audience: operator
page_kind: procedure
---

# Service Procedures

Use these procedures for the testnet Compose stack.
Run each command from the repository root.
Replace each environment-file placeholder with the generated file defined in
[Generate an Environment Family](../lifecycle/configure-the-treasury.md#generate-an-environment-family).

For Kubernetes commands, use the
[infrastructure runbooks](../infrastructure/index.md). Do not apply Compose
restart commands to Kubernetes workloads.

## Before you start

Confirm these conditions:

- the environment files describe one deployment;
- the Mina GraphQL endpoint is reachable from the host and browser;
- the Archive GraphQL endpoint is reachable from the containers;
- `TREASURY_OWNER_CONTRACT_ADDRESS` identifies the intended treasury;
- Postgres and lifecycle bind-mount paths have sufficient space;
- the staking-ledger source is available when the scheduler must run.

Render the resolved Compose configuration:

```bash
pnpm testnet:config
```

Review the result before you start or recreate a service.

## Start the normal stack

Start the existing images:

```bash
pnpm testnet:up
```

Build the images and start the stack:

```bash
pnpm testnet:up:build
```

These commands select the local `proxy` profile.
They preserve named volumes and lifecycle bind mounts.

## Start proof services

Set `PROOFS_ENABLED=true` in `<DEVOPS_ENV_FILE>` and `<API_ENV_FILE>`.
Render the proving profile:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proving \
  config
```

Confirm that the resolved proving scheduler and worker values are exactly
`true`.

Start the stack with Redis, the proving scheduler, and proving workers:

```bash
pnpm testnet:up:proving
```

Build the images before this start:

```bash
pnpm testnet:up:proving:build
```

Confirm that the deployment has the required proof capacity.
The proof profile does not create the Vote Reducer proof or submit the tally.

## Start the public proxy

Start the public HTTPS profile with existing images:

```bash
pnpm testnet:up:public
```

Build the images before this start:

```bash
pnpm testnet:up:public:build
```

The public profile requires `LETSENCRYPT_EMAIL` and `PUBLIC_WEB_DOMAIN`.
Do not publish the Backoffice application through this profile.

## Inspect service state

List the local-profile containers:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  ps
```

Follow all local-profile logs:

```bash
pnpm testnet:logs
```

Follow one service:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  logs --follow indexer
```

Replace `indexer` with the exact Compose service name.

## Check the HTTP services

Run these checks through the local direct ports:

```bash
curl --fail-with-body http://127.0.0.1:4100/healthz
curl --fail-with-body http://127.0.0.1:4101/healthz
curl --fail-with-body http://127.0.0.1:4101/status | jq
curl --fail-with-body http://127.0.0.1:4102/healthz
curl --fail-with-body http://127.0.0.1:4102/status | jq
```

Each `/healthz` response only means that its HTTP process responds.
It does not test Postgres, Archive GraphQL, a worker loop, or data freshness.

The Indexer API `/status` response contains these progress values:

- Archive pending and canonical maximum block heights;
- pending and canonical indexer cursors;
- remaining pending and canonical block counts.

The Processor API `/status` response contains these progress values:

- the processor name;
- its last event timestamp and identifier;
- the offset update time;
- the remaining event count.

Compare values at two different times.
A static `ok: true` value does not prove progress.

## Check schedulers and proof workers

Check the voting-ledger scheduler logs and `.sqlite.done` marker:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  logs --tail 200 voting-ledger-scheduler
```

For the proving profile, check Redis and the proof processes:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  --profile proving \
  exec redis redis-cli ping

docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  --profile proving \
  logs --tail 200 proving-scheduler proving-worker
```

Check proof files and the `.sqlite.proven` marker for the lifecycle.
Do not infer tally submission from the marker.

For one-shot scheduler recovery, do not use `docker exec` on a running
scheduler. Use the stopped procedures in
[Ledgers and proving](../proving/ledgers-and-proving.md). These procedures stop
the applicable scheduler and restart it after verification.

## Stop the full stack

Stop the normal local stack and preserve named volumes:

```bash
pnpm testnet:down
```

Stop a public-profile stack and preserve named volumes:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile public-proxy \
  down
```

Do not use `pnpm testnet:reset` as a restart command.
That command removes named volumes.

## Restart one service

Use `restart` when the service environment did not change.
For example, restart the indexer after a temporary Archive service failure:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  restart indexer
```

Restart both SQLite readers after you replace an active lifecycle SQLite file:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  restart api processor
```

Restart `processor` after a temporary Indexer API failure.
Restart only the affected API after a temporary HTTP-process failure.

## Recreate a service after an environment change

The `restart` command does not load changed environment values.
Use `up` to recreate the affected service.

For an App API configuration change, run:

```bash
docker compose \
  --env-file <DEVOPS_ENV_FILE> \
  --env-file <API_ENV_FILE> \
  --env-file <BACKOFFICE_ENV_FILE> \
  --env-file <WEB_ENV_FILE> \
  -f devops/compose.yml \
  --profile proxy \
  up --no-build --detach api
```

For a web configuration change, replace `api` with `web`. For a Backoffice
configuration change, replace `api` with `backoffice`.
For an Archive endpoint change, recreate `indexer` and `indexer-api`.

Recreate `processor` after an Indexer API URL change.
Do not restart Postgres for an application-only change.

## Restart a Mina or Archive service

For a provider endpoint, use the provider procedure. For a self-operated
Kubernetes service, use [1a. Archive Node](../infrastructure/archive-node.md) or
[1b. Mina Daemon](../infrastructure/mina-daemon.md). These runbooks contain the
service checks and cluster commands.

After the service returns, complete these checks:

1. Confirm the provider endpoint and MINA network.
2. Confirm the treasury address through Mina GraphQL.
3. Restart or recreate the affected application process.
4. Check indexer cursors and processor offsets at two different times.
5. Reconcile the latest affected treasury account on the MINA network.

## Signal guide

| Component                | Primary signal                                 | Interpretation                                              |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------------- |
| App API                  | `/healthz` and a task-specific route.          | The process responds, and the selected read succeeds.       |
| Indexer                  | Indexer `/status` and `indexer` logs.          | Archive heads and cursors show ingestion progress.          |
| Processor                | Processor `/status` and `processor` logs.      | The offset moves and `remainingEvents` returns toward zero. |
| Voting scheduler         | Logs and `.sqlite.done`.                       | The lifecycle trace step finished.                          |
| Proving scheduler        | Logs, proof JSON, and `.sqlite.proven`.        | The configured staking-ledger proof steps finished.         |
| Proving workers          | Worker logs and Redis activity.                | Workers receive and complete queue tasks.                   |
| Web or Backoffice        | Root response and task-specific browser check. | The HTTP process and selected client path work.             |
| Mina or Archive service  | Service status and direct endpoint query.      | The service answers for the intended network.               |

## External alert integration

Connect the status fields, marker ages, process restarts, and provider signals to the selected alert service.
Set deployment-specific thresholds for lag, age, error rate, and disk use.

Keep that integration in the deployment system, outside treasury authorization logic.

## After a service change

Check the affected service and its downstream consumer.
Then reconcile any state-changing operation on the MINA network.

For data-path recovery, compare these views:

1. Mina account state;
2. canonical Archive history;
3. indexer records;
4. processor projections;
5. the web display.

## Sources

- `package.json`
- `devops/TESTNET.md`
- `devops/compose.yml`
- `apps/api/README.md`
- `packages/indexer/README.md`
- `packages/processor/README.md`
- `apps/api/src/indexer-status-routes.ts`
- `apps/api/src/processor-status-routes.ts`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `devops/docker/proving-scheduler-entrypoint.sh`
- `devops/runbooks/1-Network/1a-Archive-Node/README.md`
- `devops/runbooks/1-Network/1b-Mina-Daemon/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/README.md`
- `devops/runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md`
