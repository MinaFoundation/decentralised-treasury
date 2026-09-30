# 1c — Staking Ledger Provider

Deploy this component after the daemon (`1b`). It exports data from that daemon.
It has no other service dependency.

## Purpose

The treasury gets voting weight from the staking ledger for the lifecycle epoch.
To get a staking ledger, run `mina ledger export` _inside_ a daemon. An API,
file, or bucket does not supply this ledger. The daemon supplies the current
epoch ledger. It supplies the next epoch ledger after that ledger becomes known.
After the daemon leaves an epoch, it cannot export that epoch ledger again.

This release polls the chain. When a new epoch ledger appears, it executes a
command in a synced daemon pod. The command exports and packages the ledger.
The fetch pod copies the package to storage. A separate server pod supplies HTTP inside the namespace. The treasury voting-ledger scheduler downloads the package.

```text
  node-0 (mina) <--kubectl exec--- fetch container ---> /data (PVC)
        ^  mina ledger export                             |
        |                                            serve (nginx :8080)
        +-- graphql probe                                 |
                                                          v
                                  treasury voting-ledger-scheduler
```

The provider replaces the o1-labs GCS export. That export stopped publishing
Devnet ledgers at the 2026-08-19 hardfork. Export from the operator daemon
removes the external publisher from the data path.

### Ledger names use the hash, not only the epoch

Mina resets the epoch number to 0 at each hardfork. Thus, an epoch number can
identify more than one ledger across eras. The ledger hash identifies the
ledger. The treasury circuits enforce this hash. A proposal stores
`stakingEpochData.ledger.hash` on the MINA network. The proof compares the
hydrated ledger with this hash.

Archive names use `staking-<epoch>-<hash>.json.tar.gz`. The member in the archive
uses `<hash>.json`. The epoch helps the operator browse the files. The consumer
selects a file by its hash.

## Components

| Component  | Object                                       | Role                                                                                |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Fetch loop | Deployment `mina-staking-ledgers-provider-fetch`, container `fetch`                            | Polls the chain, runs commands in the daemon, and exports and verifies ledgers      |
| Server     | Deployment `mina-staking-ledgers-provider-serve`, container `serve` (nginx, `:8080`)           | Read-only JSON autoindex over the ledger directory                                  |
| Storage    | `PVC/mina-staking-ledgers-provider` (20Gi)   | Published archives. The fetch and serve pods share this claim on one node. The server mount is read-only. |
| Service    | `Service/mina-staking-ledgers-provider:8080` | Supplies the treasury download endpoint                                             |
| RBAC       | `Role` + `RoleBinding`                       | `pods get/list` and `pods/exec create`, bound only to fetch. Serve has no Kubernetes API token.          |

Keep the replica count at `1`. The template rejects all other values.

- Chart: <https://github.com/MinaFoundation/helm-charts.git>
  (`mina-staking-ledgers-provider`, pinned to source commit
  `c648c68ab8ee1f1cb2a88e91c022411aafcb82f2`).
- Values: Use `helmfile.yaml` in this directory.

## Complete the chart security migration

The checked-in Helmfile pins exact published source commit
`c648c68ab8ee1f1cb2a88e91c022411aafcb82f2` from
[PR 346](https://github.com/MinaFoundation/helm-charts/pull/346). This source
contains the prepared split chart. The PR still needs the required reviews,
merge, and a release tag. The immutable pin supports deterministic review and
rendering; it does not claim a released or deployed chart. Complete those gates
and the procedures below before a rollout.

Preserve the existing ledger PVC and Service names.
Stop the old combined Deployment before starting the new `-fetch` Deployment; do not run two fetch writers.
Do not delete its PVC. The old deployment name is `mina-staking-ledgers-provider`.

The two pods have separate ServiceAccounts. Only fetch has the daemon namespace RoleBinding.
Serve has no cloud annotation or Kubernetes API token, and mounts the claim read-only.
Set `minaNamespace` to the narrow daemon namespace.
The label selector does not restrict the RBAC permission to matching pods.

Required pod affinity places both pods on one node for `ReadWriteOnce` storage.
Do not use `ReadWriteOncePod`. Verify storage topology and node capacity before rollout.
A disabled Kubernetes token mount does not remove cloud identity tokens injected by a webhook.
Inspect existing accounts, cloud trust, RoleBindings, and metadata access before deployment.
Render checks do not establish these live permissions.

## Prerequisites

- Apply runbook `1b`. The daemon must report `Synced`.
- Set the `queryableNode: "true"` label on the daemon pod. Runbook `1b` sets
  this label in `podLabels`.
- Make sure that `Service/graphql-proxy` resolves for the low-cost probe.

## 1. Check The Values That Matter

| Value                 | Current                             | Why                                                                                                                                                   |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fullnameOverride`    | `mina-staking-ledgers-provider`     | The treasury chart uses this exact Service name by default. Without the override, Helm adds the release-name prefix and the default does not resolve. |
| `minaNodeLabel`       | `queryableNode=true`                | Selects candidate daemon pods. The provider probes each match and uses the first pod that reports `Synced`.                                           |
| `minaContainer`       | `mina`                              | Identifies the container in which the provider runs the export command.                                                                               |
| `minaNodeUrl`         | `http://graphql-proxy:3085/graphql` | This low-cost probe determines whether work exists. The provider reads the export hash again from the selected pod IP.                                |
| `pollIntervalSeconds` | `3600`                              | An epoch is 7d10h30m, so an hourly poll is more frequent than required. A no-op cycle uses one GraphQL query.                                         |
| `exportNextEpoch`     | `true`                              | `next(N)` is byte-identical to `staking(N+1)`. An early export gives up to one epoch of additional preparation time.                                  |
| `keepLastN`           | `8`                                 | A lifecycle spans four epochs and can require an old ledger. The value supplies additional retention because a pruned ledger is not recoverable.      |
| `persistence.size`    | `20Gi`                              | Each Devnet archive is approximately 18MB. This capacity is sufficient for `keepLastN: 8`.                                                            |

The live release also sets `nodeSelector: karpenter.sh/nodepool: amd64-spot` with
a matching toleration. The volume is zonal and `ReadWriteOnce`. Therefore, a
replacement pod must start in the volume Availability Zone. This nodepool permits
spot and on-demand nodes. This configuration keeps the only staking-ledger
producer schedulable. Add this configuration if you apply this file.

## 2. Diff, Then Apply

```bash
cd devops/runbooks/1-Network/1c-Staking-Ledger-Provider
helmfile template . | kubectl diff -n devnet -f -
helmfile template . | kubectl apply -n devnet -f -
```

The PVC uses `ebs-gp3-encrypted`, which has the `Delete` reclaim policy. Do not
run `helm uninstall` or `kubectl delete pvc` for this release. After the daemon
leaves an epoch, it cannot export that epoch archive again.

## 3. Watch The First Cycle

```bash
kubectl logs -n devnet deploy/mina-staking-ledgers-provider-fetch -c fetch -f
```

A cycle with work logs the export, hash, verification, and published object. A
cycle without work is the usual condition. It does not access a pod and gives
this output:

```text
[staking-ledgers-provider] chain advertises epoch=1 staking=jxUYRdFc… next=jy21LAdv…
[staking-ledgers-provider] already published; nothing to do
```

The provider verifies an export before publication. The archive must contain
exactly one `.json` member with the hash as its name. This member must contain a
non-empty account array. The provider first writes `.<name>.part`. It renames the
file only after completion. Thus, a consumer cannot list a partial file.

## 4. Verify

Inspect the published files:

```bash
kubectl exec -n devnet deploy/mina-staking-ledgers-provider-serve -c serve -- \
  sh -c 'ls -la /data; cat /data/.provider-status'
```

`.provider-status` is the heartbeat. `lastSuccessAt` must be within one poll
interval. The `archives` value must match the file count.

Query the HTTP interface that the treasury uses:

```bash
kubectl exec -n devnet deploy/archive-node -c archive -- \
  bash -c 'curl -s http://mina-staking-ledgers-provider:8080/'
```

The interface returns this JSON autoindex:

```json
[
  {
    "name": "staking-1-jxUYRdFcuDDMyEtRXkAEo74EFpFSAjcVf6pBX9j56siW7rFZFRq.json.tar.gz",
    "type": "file",
    "size": 18323308
  },
  {
    "name": "staking-2-jy21LAdvh6qC6uxz8YqpUzd2C8ckoemFb4votn6DUgjtQkLeVxG.json.tar.gz",
    "type": "file",
    "size": 18411506
  }
]
```

Compare an archive hash with the hash that the chain supplies. The hashes must
match. Without a matching ledger, the treasury cannot generate the applicable
proof.

```bash
kubectl exec -n devnet deploy/node-0 -c mina -- bash -c \
  'curl -s -X POST http://localhost:3085/graphql -H "content-type: application/json" \
     -d "{\"query\":\"{ bestChain(maxLength:1){ protocolState{ consensusState{ epoch stakingEpochData{ ledger{ hash } } nextEpochData{ ledger{ hash } } } } } }\"}"'
```

The `/healthz` endpoint on the serving container returns `200 ok`.

## 5. Provide the Treasury Input

The voting-ledger scheduler reads archives from the Service through HTTP:

```yaml
votingLedgerScheduler:
  stakingLedgers:
    source: http
    bucket: http://mina-staking-ledgers-provider:8080
```

See runbook `2c`. The data stays in the cluster. This path does not use an
object store.

## Troubleshooting

| Symptom                                                          | Cause / fix                                                                                                                                                            |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no pods match label 'queryableNode=true'`                       | The daemon does not have the `podLabels.queryableNode` value from `1b`.                                                                                                |
| `no synced node among: …`                                        | The daemon is not `Synced`. An unsynced node can export a ledger for a chain that the operator does not follow. This rejection is correct. Correct runbook `1b` first. |
| `exported … hashes to X but the chain advertises Y - discarding` | The daemon changed epoch during the export. The next cycle exports the ledger. No manual action is necessary.                                                          |
| `could not export next-epoch-ledger; continuing`                 | This condition is normal early in an epoch. The daemon does not yet supply a next-epoch ledger. It is not fatal.                                                       |
| Probe fails, cycle still runs                                    | `minaNodeUrl` is not reachable. This probe only skips unnecessary work. The loop then inspects pods directly. This action costs more resources but stays correct.      |
| An epoch ledger is absent                                        | The daemon cannot export the ledger after it passes that epoch. Check for the hash in another environment before you identify it as lost.                              |
| Pod is `Pending` after a restart                                 | The PVC is zonal and `ReadWriteOnce`. Confirm that `nodeSelector` and `tolerations` permit a node in the volume Availability Zone.                                     |
| `required tool 'kubectl' is not on PATH`                         | The `alpine/k8s` image tag changed. It must supply kubectl, python3, and curl. It must also track the Kubernetes minor version of the cluster.                         |

## References

- Chart: <https://github.com/MinaFoundation/helm-charts/tree/main/mina-staking-ledgers-provider>.
  `scripts/provide-staking-ledgers.sh` contains all provider logic.
- Consumer: `votingLedgerScheduler.stakingLedgers` in the treasury helmfile.
- Previous: `1b-Mina-Daemon`. Next: `2a-Generate-Treasury-Wallet`.
