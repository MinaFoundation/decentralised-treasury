# 1c — Staking Ledger Provider

Deploy after the daemon (`1b`). It exports from that daemon and depends on
nothing else.

## What It Does

Voting weight in the treasury comes from the staking ledger for a lifecycle's
epoch. A staking ledger is only obtainable by running `mina ledger export`
*inside* a daemon — there is no API, no file, no bucket. And the daemon only
serves the ledger for the epoch it is currently in and the next epoch's ledger
once it is known: once it moves past an epoch, that epoch's ledger cannot be
re-exported at any price.

So this release polls the chain, and whenever a new epoch's ledger appears it
execs into a synced daemon pod, exports the ledger, packs it, copies it out, and
serves it over HTTP inside the namespace. The treasury's voting-ledger scheduler
downloads from there.

```text
  node-0 (mina) <--kubectl exec--- fetch container ---> /data (PVC)
        ^  mina ledger export                             |
        |                                            serve (nginx :8080)
        +-- graphql probe                                 |
                                                          v
                                  treasury voting-ledger-scheduler
```

It replaced the o1-labs GCS export, which stopped publishing devnet ledgers at
the 2026-08-19 hardfork. Exporting from our own daemon means no external
publisher in the path.

### Ledgers are named by hash, not by epoch

Mina resets the epoch number to 0 at every hardfork, so an epoch number is
ambiguous across eras. The ledger hash is not, and it is the value the treasury
circuits actually enforce — a proposal snapshots `stakingEpochData.ledger.hash`
on-chain and the proof asserts the hydrated ledger against it.

Archives are therefore named `staking-<epoch>-<hash>.json.tar.gz`, with the
member inside named `<hash>.json`. The epoch is there so a human can browse; the
consumer matches on the hash.

## Components

| Component | Object | Role |
| --- | --- | --- |
| Fetch loop | container `fetch` | Polls, execs into the daemon, exports and verifies ledgers |
| Server | container `serve` (nginx, `:8080`) | Read-only JSON autoindex over the ledger directory |
| Storage | `PVC/mina-staking-ledgers-provider` (20Gi) | Published archives. `ReadWriteOnce`, hence HTTP rather than a shared mount |
| Service | `Service/mina-staking-ledgers-provider:8080` | What the treasury downloads from |
| RBAC | `Role` + `RoleBinding` | `pods get/list` and `pods/exec create` — unavoidable, the ledger has no other interface |

Replicas must stay `1`; the template refuses any other value.

- Chart: <https://github.com/MinaFoundation/helm-charts.git> (`mina-staking-ledgers-provider`, pinned `0.1.1`)
- Values: `helmfile.yaml` in this directory

## Prerequisites

- Runbook `1b` applied and the daemon reporting `Synced`.
- The daemon pod labelled `queryableNode: "true"` (set in `1b`'s `podLabels`).
- `Service/graphql-proxy` resolving, for the cheap probe.

## 1. Check The Values That Matter

| Value | Current | Why |
| --- | --- | --- |
| `fullnameOverride` | `mina-staking-ledgers-provider` | The treasury chart defaults to exactly this Service name. Without the override Helm prefixes the release name and the default misses |
| `minaNodeLabel` | `queryableNode=true` | Selects candidate daemon pods. Every match is probed; the first reporting `Synced` is used |
| `minaContainer` | `mina` | Container to exec into inside that pod |
| `minaNodeUrl` | `http://graphql-proxy:3085/graphql` | Cheap probe only — used to decide whether there is work. The hash that names an export is re-read from the chosen pod's own IP |
| `pollIntervalSeconds` | `3600` | An epoch is 7d10h30m, so hourly is far more often than needed. A no-op cycle costs one GraphQL query |
| `exportNextEpoch` | `true` | `next(N)` is byte-identical to `staking(N+1)`, so exporting early buys up to a full epoch of head start |
| `keepLastN` | `8` | A lifecycle spans four epochs and can need an old ledger. Generous on purpose — pruned ledgers are unrecoverable |
| `persistence.size` | `20Gi` | ~18MB per archive on devnet; plenty at `keepLastN: 8` |

The live release also pins `nodeSelector: karpenter.sh/nodepool: amd64-spot`
with a matching toleration. The volume is zonal and `ReadWriteOnce`, so a
replacement pod must come up in the volume's AZ; that nodepool allows both spot
and on-demand so the only producer of staking ledgers is never left
unschedulable. Add it back if this file is the one being applied.

## 2. Diff, Then Apply

```bash
cd devops/runbooks/1-Network/1c-Staking-Ledger-Provider
helmfile template . | kubectl diff -f -
helmfile template . | kubectl apply -f -
```

The PVC is on `ebs-gp3-encrypted`, which reclaims with `Delete`. Never
`helm uninstall` or `kubectl delete pvc` here — the archives it holds cannot be
re-exported once the daemon has moved past their epoch.

## 3. Watch The First Cycle

```bash
kubectl logs -n devnet deploy/mina-staking-ledgers-provider -c fetch -f
```

A cycle that finds work logs the export, the hash, verification, and the
published object. A cycle with nothing to do — the overwhelmingly common case —
looks like this and touches no pod at all:

```text
[staking-ledgers-provider] chain advertises epoch=1 staking=jxUYRdFc… next=jy21LAdv…
[staking-ledgers-provider] already published; nothing to do
```

An export is verified before publication: the archive must contain exactly one
`.json` member named for the hash, holding a non-empty array of accounts. It is
written as `.<name>.part` and renamed into place only once complete, so a
consumer listing the directory never sees a partial file.

## 4. Verify

What is published:

```bash
kubectl exec -n devnet deploy/mina-staking-ledgers-provider -c serve -- \
  sh -c 'ls -la /data; cat /data/.provider-status'
```

`.provider-status` is the heartbeat — `lastSuccessAt` should be within one poll
interval, and `archives` should match the file count.

The HTTP interface the treasury actually uses:

```bash
kubectl exec -n devnet deploy/archive-node -c archive -- \
  bash -c 'curl -s http://mina-staking-ledgers-provider:8080/'
```

Returns a JSON autoindex:

```json
[
{ "name":"staking-1-jxUYRdFcuDDMyEtRXkAEo74EFpFSAjcVf6pBX9j56siW7rFZFRq.json.tar.gz", "type":"file", "size":18323308 },
{ "name":"staking-2-jy21LAdvh6qC6uxz8YqpUzd2C8ckoemFb4votn6DUgjtQkLeVxG.json.tar.gz", "type":"file", "size":18411506 }
]
```

Cross-check a hash against what the chain advertises — they must match, or the
treasury has no ledger it can prove against:

```bash
kubectl exec -n devnet deploy/node-0 -c mina -- bash -c \
  'curl -s -X POST http://localhost:3085/graphql -H "content-type: application/json" \
     -d "{\"query\":\"{ bestChain(maxLength:1){ protocolState{ consensusState{ epoch stakingEpochData{ ledger{ hash } } nextEpochData{ ledger{ hash } } } } } }\"}"'
```

`/healthz` on the serving container returns `200 ok`.

## 5. Hand Off To The Treasury

The voting-ledger scheduler reads archives over HTTP from the Service:

```yaml
votingLedgerScheduler:
  stakingLedgers:
    source: http
    bucket: http://mina-staking-ledgers-provider:8080
```

See runbook `2c`. Nothing leaves the cluster and no object store is involved.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `no pods match label 'queryableNode=true'` | The daemon lost the `podLabels.queryableNode` value from `1b`. |
| `no synced node among: …` | The daemon is not `Synced`. Exporting from an unsynced node yields a ledger for a chain we are not following, so this refusal is correct — fix `1b` first. |
| `exported … hashes to X but the chain advertises Y - discarding` | The daemon moved epoch mid-export. The next cycle picks it up; nothing to do by hand. |
| `could not export next-epoch-ledger; continuing` | Normal early in an epoch — the daemon does not serve a next-epoch ledger yet. Not fatal. |
| Probe fails, cycle still runs | `minaNodeUrl` unreachable. It only skips work, so the loop falls back to inspecting pods directly — more expensive, not incorrect. |
| Missing an epoch's ledger entirely | If the daemon has passed that epoch it cannot be re-exported. Check whether the hash exists in another environment before assuming it is lost. |
| Pod `Pending` after a restart | The PVC is zonal and `ReadWriteOnce`. Check `nodeSelector`/`tolerations` allow a node in the volume's AZ. |
| `required tool 'kubectl' is not on PATH` | The `alpine/k8s` image tag was changed. It must provide kubectl, python3 and curl, and track the cluster's Kubernetes minor version. |

## References

- Chart: <https://github.com/MinaFoundation/helm-charts/tree/main/mina-staking-ledgers-provider>
  (`scripts/provide-staking-ledgers.sh` is the whole logic)
- Consumer: `votingLedgerScheduler.stakingLedgers` in the treasury helmfile
- Previous: `1b-Mina-Daemon` · Next: `2a-Generate-Treasury-Wallet`
