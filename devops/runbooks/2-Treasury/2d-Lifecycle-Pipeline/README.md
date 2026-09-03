# 2d — Lifecycle Pipeline

How a lifecycle gets built, where its artifacts end up, and why the whole thing
is safe to run on spot capacity.

Everything here runs on its own once `2c` is applied. This is the runbook for
watching it and understanding what you are looking at.

## The Pipeline

One staking ledger becomes one voting ledger, then one set of proofs. Lifecycles
are built one at a time, in order.

```text
  1c provider              voting-ledger-scheduler            proving-scheduler + workers
  ───────────              ───────────────────────            ───────────────────────────
  staking-<epoch>          from-file  ->  trace-digest        prove-digest -> prove-merge
    -<hash>.tar.gz    ─────────────────────────────────────>    -> prove-exhaust
         |                  <id>.sqlite    <id>.sqlite.done      <id>.sqlite.proven
         |                                                       proofs/<id>-*.json
         v                          v                                    v
   /staking-ledgers/           /sqlite/                             /proofs/
```

| Stage | Runs in | Parallel | Produces |
| --- | --- | --- | --- |
| `from-file` | `voting-ledger-scheduler` container | no | `<id>.sqlite`, hydrated from the staking ledger |
| `trace-digest` | same container, inline | **no — single-threaded** | the traced `<id>.sqlite`, then `<id>.sqlite.done` |
| `prove-digest`, `prove-merge` | `proving-worker` replicas, via a BullMQ queue | **yes** | per-index proofs, persisted into the lifecycle's sqlite |
| `prove-exhaust` | `proving-scheduler` pod, inline | no | `proofs/<id>-*.json`, then `<id>.sqlite.proven` |

The two schedulers pick work differently, and it matters:

- `voting-ledger-scheduler` builds only the **newest** lifecycle. It never scans
  backwards, so one that failed is not retried on its own.
- `proving-scheduler` works the backlog **oldest-first**. Skipping an older
  unproven lifecycle would leave its votes permanently untallyable — which also
  means one unprovable lifecycle blocks every later one.

## Where The Artifacts Are

All three are served read-only on the treasury host, as JSON directory listings.

```bash
H=https://<your host>
curl -s "$H/staking-ledgers/"   # runbook 1c's provider, proxied here
curl -s "$H/sqlite/"            # lifecycle databases and markers
curl -s "$H/proofs/"            # generated proofs
```

```json
[
{ "name":"0.sqlite",        "type":"file", "size":8922308608 },
{ "name":"0.sqlite.done",   "type":"file", "size":137 },
{ "name":"0.sqlite.proven", "type":"file", "size":114 },
{ "name":"21.sqlite",       "type":"file", "size":8063303680 },
{ "name":"21.sqlite.done",  "type":"file", "size":138 }
]
```

Read that listing as pipeline state. Above, lifecycle 0 is finished and 21 is
traced but not yet proven.

The markers are small JSON documents, not empty files:

```bash
curl -s "$H/sqlite/21.sqlite.done"
```

```json
{"lifecycleId":"21","ledgerHash":"jy21LAdvh6qC6uxz8YqpUzd2C8ckoemFb4votn6DUgjtQkLeVxG",
 "processedAt":"..."}
```

`ledgerHash` is the identity from runbook `1c` — the value the treasury circuits
enforce, so it is what ties a built lifecycle back to the exact staking ledger it
came from.

Both schedulers mirror these to S3 through sidecars, and the markers are what
they read on startup to decide what is already done. That is the whole of their
resume logic: **markers are state, and they are never pruned.**

## Fault Tolerance, And Why Spot Is Safe

A full build runs for hours to days — on devnet, roughly 17h of single-threaded
`trace-digest` inside an ~18.8h total for a ~92,000-account ledger. Paying
on-demand for that is expensive, and every stage here is designed so an
interruption costs *time*, never *work already done*:

- **`trace-digest` checkpoints to S3.** Every `checkpoint.intervalIndices`
  indices (500 in `2c`) it writes progress under a `.checkpoints/` prefix of the
  sqlite bucket, deleted once the `.done` marker lands. At 500 indices that
  bounds a preemption to tens of minutes rather than the whole multi-hour run.
  Set it to `0` and an interrupted trace restarts from index 0 — which is the
  chart default, and the single value that makes spot viable for this pod.
- **Proving resumes from persisted proofs.** `prove-digest` skips indices that
  already have a proof in the lifecycle's sqlite, so a replacement worker
  continues rather than redoing the range.
- **BullMQ requeues abandoned jobs.** A job whose worker vanished is picked up
  by another replica through the stalled-job check.
- **Redis keeps the queue across evictions** when
  `proving.redis.persistence.enabled` is set (PVC + AOF). Without it the queue
  comes back empty and the scheduler has to re-enqueue from the markers.
- **The schedulers themselves are stateless.** They restart, read the markers,
  and carry on.

So annotate these workloads onto spot capacity and let them be interrupted. In
`2c` that is the chart-wide `nodeSelector` pinning `karpenter.sh/capacity-type:
spot`. The only real cost of a replacement worker is the ~100s circuit compile
it pays before taking its first job.

Two workloads want different machines, which is why `2c` sets their scheduling
separately from the chart-wide default:

- `voting-ledger-scheduler` is single-threaded on the critical path, so it wants
  sustained clock speed and is worth keeping off burstable instance families —
  a `c7i-flex` gives a ~40% CPU baseline, and this pod pegs a core for hours.
- `proving-worker` wants a whole large machine each: a 16 vCPU node floor plus
  pod anti-affinity, so two workers never share a host.

## Proving Scales Itself

`proving-worker` sits at `minReplicas: 0` between lifecycles — idle replicas at
10 CPU each would keep nodes alive for nothing. The `proving-autoscale` sidecar
on the scheduler watches the queue and sets:

```text
desired = min(maxReplicas, max(1, waiting + active))
```

Scale-up is immediate, since work is already queued and waiting on capacity;
scale-down waits out `scaleDownAfterSeconds`. The ceiling is reached during
`prove-digest`, which enqueues every batch at once, and tapers through
`prove-merge` as the tree converges. `from-file` and `trace-digest` enqueue
nothing at all, so the cluster stays at zero for the long single-threaded stage.

`maxReplicas` is the one value here that turns directly into machines — each
replica takes a whole node. `2c` sets 32, sized for a full devnet-scale ledger
of ~92,000 accounts. Size it against your own.

## Recovering A Checkpoint

The scheduler restores its own checkpoint on restart, so this is only needed
when you are intervening by hand — inspecting what a preempted run left behind,
or clearing a checkpoint that no longer matches the ledger.

```bash
dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- staking-ledger-to-voting-ledger checkpoint-restore \
  --lifecycle-id <id> \
  --expected-ledger-hash <hash from the .done marker> \
  --s3-uri s3://<sqlite bucket>/<network>/.checkpoints

dotenvx run -f apps/cli/.env.testnet -- \
  pnpm run cli -- staking-ledger-to-voting-ledger checkpoint-clean \
  --lifecycle-id <id> \
  --s3-uri s3://<sqlite bucket>/<network>/.checkpoints
```

`--expected-ledger-hash` is mandatory and checked: a checkpoint only resumes
against the ledger it was taken from, so a restore cannot silently graft one
lifecycle's progress onto another. Take the hash from that lifecycle's `.done`
marker.

`checkpoint-clean` deletes a lifecycle's checkpoints. The scheduler does this
itself once `.done` is written, so reach for it only when a checkpoint is
stale or unusable and the next attempt should start clean.

## Watching A Build

```bash
kubectl logs -n <namespace> deploy/decentralized-treasury-voting-ledger-scheduler \
  -c voting-ledger-scheduler -f

kubectl logs -n <namespace> deploy/decentralized-treasury-proving-scheduler \
  -c proving-scheduler -f

kubectl logs -n <namespace> deploy/decentralized-treasury-proving-scheduler \
  -c proving-autoscale -f
```

Worker count is the quickest read on whether proving is live:

```bash
kubectl get deploy -n <namespace> decentralized-treasury-proving-worker
```

`0/0` means nothing is queued. During `trace-digest` that is correct and expected
— not a stall.

The scheduler pod runs several sidecars, each worth knowing by name when reading
events: `s3-sync` (pull), `s3-push-markers`, `s3-push-proofs`, `serve-artifacts`
(the nginx serving `/sqlite` and `/proofs`), and `proving-autoscale`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Nothing progresses, workers at `0/0` | Normal during `from-file`/`trace-digest`, which enqueue nothing. Check the voting-ledger-scheduler log for the traced index count. |
| A lifecycle has no `.done` and is never retried | `voting-ledger-scheduler` only builds the newest. Rebuild the specific id by hand. |
| Proving stuck on an old lifecycle | The scheduler is strictly oldest-first, so one unprovable lifecycle starves every later one. Fix it, or as a last resort unblock the queue by hand-writing its `.proven` marker with a reason — an escape hatch, not part of the normal flow. |
| `trace-digest` restarts from zero after an eviction | `checkpoint.intervalIndices` is `0`. Set it before running on spot. |
| Queue empty after a redis restart, progress lost | `proving.redis.persistence.enabled` is off. Proofs already in sqlite survive; the queue does not. |
| `/sqlite` and `/proofs` 502 | The proving-scheduler Service is missing — see the `extraObjects` workaround in `2c`. |
| S3 and local sizes disagree | A multipart upload is in flight; `list-objects-v2` reports the partial size. Wait a push cycle before concluding anything. |

## References

- Compose equivalent: `devops/TESTNET.md`, "Lifecycle Data And Proofs"
- Chart: <https://github.com/MinaFoundation/helm-charts/tree/main/decentralized-treasury>
  (`scripts/proving-autoscale.mjs` is the autoscaler)
- Previous: `2c-Deploy-Stack`
