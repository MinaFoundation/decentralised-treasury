# 1a — Archive Node

Stand this up first. Nothing else in the runbook works without it.

## What It Does

A Mina daemon serves current state only. It cannot answer "which events did this
zkApp emit, at which height, and is that block canonical yet?" — which is the
treasury's whole read path.

The daemon streams every accepted block to the archive node, which writes blocks,
transactions and zkApp events into Postgres. The Archive-Node-API then serves
GraphQL over that database, and is the only piece the treasury talks to.

```text
  node-0 daemon --(archive:3086)--> archive-node --> archive-postgresql
                                                          ^
                          archive-guardian (hourly) ------+
                                                          |
  treasury indexer <-- archive-node-api:8080 -------------+
```

The indexer uses two queries only: `networkState` (chain heads) and `events`
(filtered on the treasury owner address). Archive lag is treasury lag.

## Components

| Component | Object | Role | On |
| --- | --- | --- | --- |
| Archive node | `Deployment/archive-node`, `Service/archive:3086` | Receives blocks from the daemon, writes them to Postgres | yes |
| Postgres | `StatefulSet/archive-postgresql`, `PVC/data-archive-postgresql-0` | The archive database | yes |
| Bootstrap | `Job/archive-db-bootstrap` | Restores o1's daily dump instead of replaying from genesis | yes |
| Dump exporter | — | Publishes our own dump to S3; we consume o1's instead | **no** |
| Guardian | `CronJob/archive-guardian` | Hourly gap audit + refetch of missing blocks | yes |
| Node API | `Deployment/archive-node-api`, `Service/archive-node-api:8080` | GraphQL endpoint for the treasury | yes |

Names derive from `fullnameOverride: archive`.

- Chart: <https://github.com/MinaFoundation/helm-charts.git> (`mina-archive`)
- Image tag: the release announcement for the network in
  <https://github.com/MinaProtocol/mina/discussions> (see step 1)
- Values: `helmfile.yaml` in this directory

## Prerequisites

- `kubectl` on the `production` cluster, namespace `devnet` existing
- `helmfile`, `helm`, `helm-git` plugin (the chart is pulled from git)
- A valid secrets-manager session **before templating** — `fetchSecretValue`
  resolves at render time
- There is no ArgoCD. Everything below is applied by hand.

## 1. Pick The Image Tag

The archive and the daemon (`1b`) must run the same build, or the archive
silently rejects blocks.

Tags come from the official release announcement for the network, published in
<https://github.com/MinaProtocol/mina/discussions>. Devnet 4.0.0 "Mesa" is
<https://github.com/MinaProtocol/mina/discussions/19236>. One announcement
carries everything needed to verify a deployment — both image tags, the git
commit SHA, and the chain id that `1b` step 5 checks:

```text
minaprotocol/mina-archive:4.0.0-6965b50-<codename>-devnet
minaprotocol/mina-daemon:4.0.0-6965b50-<codename>-devnet
```

`<codename>` is the base OS — focal, jammy, noble, bullseye or bookworm. This
helmfile uses `bookworm`, so `4.0.0-6965b50-bookworm-devnet`.

Cross-check against whatever the daemon is already running:

```bash
kubectl get deploy -n devnet node-0 \
  -o jsonpath='{.spec.template.spec.containers[*].image}{"\n"}'
```

`nodeApi.image.tag` (`ghcr.io/o1-labs/archive-node-api`, currently `0.0.9`) is
released separately by o1-labs and does not appear on that page.

## 2. Set The Database Credentials

`helmfile.yaml` ships placeholders (`dummyuser` / `dummypass`). Replace them
before rendering:

```yaml
database:
  username: dummyuser
  password: dummypass
```

Rendered manifests carry the credentials in plain text (`--postgres-uri`,
`PG_CONN`) — never commit one. Changing the password later has no effect: the
Bitnami subchart only applies credentials to an empty data directory.

## 3. Check The Values That Matter

| Value | Current | Why |
| --- | --- | --- |
| `network` | `devnet` | Selects the dump URL and the guardian's block filenames |
| `postgresql.primary.persistence.size` | `20Gi` | ~3.3Gi used at ~692k blocks; only grows |
| `postgresql.primary.resourcesPreset` | `2xlarge` | Too small and the daemon's writes time out |
| `node.replicas` | `1` | The chart fails the render above 1 — one process per database |
| `dbBootstrap.enabled` | `true` | See step 5 |
| `missingBlocksGuardian.enabled` | `true` | The only thing that repairs a gap after downtime |
| `nodeApi.enabled` | `true` | No GraphQL without it, so no treasury |

## 4. Diff, Then Apply

```bash
cd devops/runbooks/1-Network/1a-Archive-Node
helmfile template . | kubectl apply -f -
```

## 5. Watch The Bootstrap

```bash
kubectl logs -n devnet -f job/archive-db-bootstrap
```

It creates a lock database (`archive_locked`), restores o1's dated dump, then
drops the lock. Devnet takes ~4 minutes. Every other archive pod waits on that
lock in an init container, so `Init:0/1` during this window is healthy.

## 6. Verify

```bash
kubectl get pods -n devnet | grep archive
```

Expect `archive-node`, `archive-node-api`, `archive-postgresql-0` Running and
`archive-db-bootstrap` Complete.

Blocks arriving — run twice a minute apart, `max_height` must move:

```bash
kubectl exec -n devnet archive-postgresql-0 -- bash -c \
  'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d archive \
     -c "SELECT max(height) AS max_height, count(*) AS blocks FROM blocks;"'
```

No gaps (expect "no missing blocks" and "no gaps in the chain statuses"):

```bash
kubectl exec -n devnet deploy/archive-node -c archive -- bash -c \
  'mina-missing-blocks-auditor --archive-uri "$PG_CONN"' | tail -3
```

GraphQL, the endpoint the treasury will use:

```bash
kubectl exec -n devnet deploy/archive-node -c archive -- bash -c \
  'curl -s -X POST http://archive-node-api:8080 -H "content-type: application/json" \
     -d "{\"query\":\"query { networkState { maxBlockHeight { canonicalMaxBlockHeight pendingMaxBlockHeight } } }\"}"'
```

`pendingMaxBlockHeight` should sit at or above canonical, both tracking
`max_height`. `/healthcheck` returns `200` with an empty body.

## 7. Point The Daemon At It

In the daemon helmfile (runbook `1b-Mina-Daemon`):

```yaml
node:
  archive:
    enabled: true
    address: archive:3086
```

## Future Step

Run a guardian pass on demand after downtime, or to accelerate the initial
catch-up once the daemon is deployed rather than waiting for the hourly
`archive-guardian` CronJob:

```bash
kubectl create job -n devnet --from=cronjob/archive-guardian archive-guardian-manual
```

## The Archive DB Is A Cache

Treat the archive Postgres as disposable, not as data of record. It can be
dropped and rebuilt from scratch at any time — restore o1's dump (step 5) and
let the hourly guardian fill the gaps, and it's back to the same state. There is
no need for a managed cloud database (e.g. RDS): the in-cluster
`StatefulSet/archive-postgresql` with its PVC is sufficient, and treating it as
a cache means losing the PVC is an inconvenience, not a data-loss incident.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Pods stuck in `Init` after bootstrap finished | `archive_locked` survived a SIGKILL. `DROP DATABASE archive_locked` by hand. |
| Bootstrap 404s on the dump | `[DATE]` expands to today; o1 publishes hours into the day. Wait, or pin yesterday's URL. |
| "Database exists but looks invalid" | Half-restored dump — drop the database, re-run the Job. |
| `max_height` frozen | Check the daemon is SYNCED, its archive address, archive pod restarts, disk full. Usually a daemon problem. |
| API Ready but queries empty | Check `networkState` first. If heights advance the data is there; `zkappCommands` has returned nothing for landed transactions on devnet. Verify in SQL before assuming a failed transaction. |
| Disk filling | `kubectl exec -n devnet archive-postgresql-0 -- df -h /bitnami/postgresql`. Patch the PVC directly (the `volumeClaimTemplate` is immutable) and update the helmfile to match. |

## References

- Chart: <https://github.com/MinaFoundation/helm-charts/tree/main/mina-archive>
- Consumer: `packages/indexer/src/archive/client.ts`, `queries.ts`
- Local equivalent: `devops/TESTNET_MINA_NODE.md`
- Next: `1b-Mina-Daemon`
