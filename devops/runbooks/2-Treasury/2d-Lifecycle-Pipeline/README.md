# 2d — Lifecycle Pipeline

This runbook explains how the system builds a lifecycle. It identifies the
artifact locations and the recovery mechanisms for spot-capacity operation.

The lifecycle pipeline starts automatically after the operator applies runbook
`2c`. Use this runbook to monitor the pipeline and interpret its state.

## The pipeline

The pipeline converts one staking ledger into one voting ledger. The pipeline
then creates one proof set. The system traces and proves one lifecycle at a
time.

```text
  1c provider + input sync voting-ledger-scheduler            proving-scheduler + workers
  ───────────              ───────────────────────            ───────────────────────────
  staking-<epoch>          from-file  ->  trace-digest        prove-digest -> prove-merge
    -<hash>.tar.gz    ─────────────────────────────────────>    -> prove-exhaust
         |                  <id>.sqlite    <id>.sqlite.done      <id>.sqlite.proven
         |                                                       proofs/<id>-*.json
         v                          v                                    v
   /staking-ledgers/           /sqlite/                             /proofs/
```

The diagram compresses one normalization stage. The input sync extracts the
provider archive. It writes `<ledgerHash>.json` before it writes
`lifecycle-<id>.hash`. The scheduler consumes this normalized pair. It does not
parse the provider archive name or calculate an epoch.

### A lifecycle whose epoch has passed cannot resolve

Because selection is keyed on the ledger hash rather than the epoch number, the
sync has to ask the daemon which hash belongs to a lifecycle. The daemon
advertises exactly two: `stakingEpochData.ledger.hash` for the current epoch
and `nextEpochData.ledger.hash` for the next one. A lifecycle whose epoch is
further in the past than that has no live path back to its hash, and the cycle
summary reports it as unresolved:

```text
cycle summary: listed=2584 selected=0 fetched=0 unparseable=0 unresolved=[0:no-hash]
```

The archive itself may well be in the bucket - the producer names its objects
`<epoch>-<hash>.tar.gz` - but this container does not read epochs out of
filenames, so it cannot make the connection. Pin the hash in
`stakingLedgers.lifecycleLedgerHashes` as `<id>=<hash>` to resolve one
explicitly.

Do not confuse this with `no-object`, which looks similar and is benign:

```text
ERROR lifecycle 2 needs ledger jxuCXj4v... (resolved via daemon), but no object
in <bucket> carries that hash
cycle summary: listed=2590 selected=0 fetched=0 unparseable=0 unresolved=[2:no-object]
```

There the hash resolved correctly and only the archive is missing, because the
producer writes one object per epoch boundary while this sync polls every five
minutes. A lifecycle that begins just before its epoch's archive is uploaded
reports `no-object` for one cycle and fetches on the next, with no
intervention. `no-hash` does not clear on its own; `no-object` usually does.

This is why a treasury deployed at a slot several epochs in the past starts
with its first lifecycles permanently unresolvable. It does not wedge anything:
the proving scheduler only considers lifecycles that already have a `.sqlite`
and a `.done` in S3, so a lifecycle that was never built cannot starve later
ones. Decide whether those early lifecycles are worth pinning - one whose
voting period has already closed usually is not.

| Stage                         | Runs in                                       | Parallel                 | Produces                                                |
| ----------------------------- | --------------------------------------------- | ------------------------ | ------------------------------------------------------- |
| `from-file`                   | `voting-ledger-scheduler` container           | no                       | `<id>.sqlite`, hydrated from the staking ledger         |
| `trace-digest`                | same container, inline                        | **no — single-threaded** | the traced `<id>.sqlite`, then `<id>.sqlite.done`       |
| `prove-digest`, `prove-merge` | `proving-worker` replicas, via a BullMQ queue | **yes**                  | per-index proofs, persisted into the lifecycle's sqlite |
| `prove-exhaust`               | `proving-scheduler` pod, inline               | no                       | `proofs/<id>-*.json`, then `<id>.sqlite.proven`         |

The two schedulers select work differently:

- During each poll, `voting-ledger-scheduler` scans all available lifecycle
  pointers. It processes unfinished lifecycles **newest-first** in one pass. A
  failed lifecycle enters bounded backoff. The scheduler continues with other
  eligible lifecycle pointers.
- `proving-scheduler` selects one unproven lifecycle **oldest-first** during
  each poll. An unprovable lifecycle remains the oldest item. Therefore, it
  blocks all later lifecycles.

Runbook `2c` sets `stakingLedgersKeepLastN: 1`, so the normal source window
contains only the newest lifecycle pointer. Set `lifecycleIds` when the
scheduler must get and process specific older lifecycles.

## Artifact locations

The treasury host serves all three artifact groups as read-only JSON directory
listings.

```bash
H=https://<your host>
curl -s "$H/staking-ledgers/"   # runbook 1c's provider, proxied here
curl -s "$H/sqlite/"            # lifecycle databases and markers
curl -s "$H/proofs/"            # generated proofs
```

```json
[
  { "name": "0.sqlite", "type": "file", "size": 8922308608 },
  { "name": "0.sqlite.done", "type": "file", "size": 137 },
  { "name": "0.sqlite.proven", "type": "file", "size": 114 },
  { "name": "21.sqlite", "type": "file", "size": 8063303680 },
  { "name": "21.sqlite.done", "type": "file", "size": 138 }
]
```

Use the listing to read the pipeline state. In the example, lifecycle 0 is
complete. Lifecycle 21 is traced but does not have a final proof.

The markers are small JSON documents. They are not empty files:

```bash
curl -s "$H/sqlite/21.sqlite.done"
```

```json
{
  "lifecycleId": "21",
  "ledgerHash": "jy21LAdvh6qC6uxz8YqpUzd2C8ckoemFb4votn6DUgjtQkLeVxG",
  "processedAt": "..."
}
```

`ledgerHash` is the ledger identity from runbook `1c`. The treasury circuits
enforce this value. Therefore, the value links the built lifecycle to its exact
staking ledger.

Sidecars mirror the SQLite files, proof files, and completion markers to S3. At
startup, the sidecars restore the published artifacts. The `.done` and
`.proven` markers identify completed stages. S3 checkpoints separately supply
partial `trace-digest` recovery. **Completion markers are state, and the system
never prunes them.**

## Clear artifacts before redeploying a treasury

Lifecycle ids are relative to `treasuryDeployedAtSlot`, so a redeployed
treasury reuses ids that the previous deployment already published under the
same `network` prefix. Clear both prefixes first, or the stack adopts the old
network's artifacts as its own.

Order matters, because the sidecars will undo a naive deletion. `s3-sync-init`
pulls the prefix down into the pod at startup and `s3-push` pushes it back on
its own schedule, so objects deleted while those pods run reappear with fresh
timestamps:

```bash
# 1. Stop the producers and pushers.
kubectl scale deploy -n <namespace> --replicas=0   decentralized-treasury-voting-ledger-scheduler   decentralized-treasury-proving-scheduler   decentralized-treasury-proving-worker

# 2. Wait for them to terminate, then delete. Scope to the prefix - these
#    buckets hold other networks under sibling prefixes.
aws s3 rm "s3://<sqlite bucket>/<network>/" --recursive
aws s3 rm "s3://<proofs bucket>/<network>/" --recursive

# 3. Bring them back, with an empty prefix to sync from.
kubectl scale deploy -n <namespace> --replicas=1   decentralized-treasury-voting-ledger-scheduler   decentralized-treasury-proving-scheduler
```

Check whether the buckets are versioned before relying on the delete being
final: with versioning enabled `aws s3 rm` writes delete markers and the
objects remain recoverable, which is usually what you want here.

The indexer's Postgres holds a cursor that also predates the new contracts.
`EVENTS_START_HEIGHT` only applies to a database that has not indexed yet
(see `2c`), so a redeploy wants a fresh volume as well.

## Fault tolerance and spot operation

A complete build can run for hours or days. On devnet, a ledger with
approximately 92,000 accounts needs approximately 18.8 hours. The
single-threaded `trace-digest` stage uses approximately 17 hours of this time.
On-demand capacity for this period is expensive. The pipeline can retain
completed work after an interruption. These mechanisms do not guarantee valid
intermediate state after each failure. An interrupted SQLite flush can produce
partial state. Before work continues, check the markers, SQLite data, and
persisted proofs. Rebuild invalid lifecycle state.

- **`trace-digest` writes checkpoints to S3.** After each
  `checkpoint.intervalIndices` indices, the process tries to write an immutable
  SQLite snapshot below the `.checkpoints/` prefix of the SQLite bucket.
  Runbook `2c` sets the interval to 500. The process also requests a checkpoint
  at normal completion and when it receives `SIGTERM`. It does not start a new
  upload while an earlier upload is active. A failed upload does not stop the
  trace, so recovery uses the last valid checkpoint. After `trace-digest`
  completes, the scheduler deletes the checkpoint and then writes the `.done`
  marker. After a recoverable interruption, the operator repeats only the work
  after the latest valid checkpoint. The actual time depends on ledger size and
  throughput. The chart default is `0`. With this value, an interrupted trace
  restarts at index 0. A nonzero interval permits checkpoint-based recovery. It
  does not guarantee that every spot interruption is recoverable.
- **Proving can resume from valid persisted proofs.** `prove-digest` skips an
  index when the lifecycle SQLite file contains its proof. After an
  interruption, verify the file before a replacement worker uses the file.
- **BullMQ requeues abandoned jobs.** The stalled-job check assigns a job to
  another replica when its worker stops.
- **Redis keeps the queue after evictions** when
  `proving.redis.persistence.enabled` is set with PVC and AOF. Without this
  setting, Redis restarts with an empty queue. The scheduler must then enqueue
  the work again from the markers.
- **The schedulers are stateless.** After a restart, the schedulers read the
  markers and continue the work.

Use spot capacity only when the checkpoint and persistence settings are active.
The operator must accept possible recovery or rebuild work. In `2c`, the
chart-wide `nodeSelector` selects `karpenter.sh/capacity-type: spot`. During a
normal resume, a replacement worker needs approximately 100 seconds to compile
the circuit. The worker then starts its first job.

The two workloads have different compute requirements. Therefore, `2c` sets
their scheduling separately from the chart-wide default:

- `voting-ledger-scheduler` is single-threaded on the critical path. It requires
  sustained clock speed. Do not use burstable instance families. A `c7i-flex`
  supplies an approximately 40% CPU baseline, and this pod fully uses one core
  for hours.
- Each `proving-worker` requires a complete large machine. The configuration
  requires a node with at least 16 vCPUs. Pod anti-affinity prevents two workers
  from sharing one host.

## Proving autoscaling

Between lifecycles, `proving-worker` uses `minReplicas: 0`. Each idle replica
requests 10 CPUs and would keep a node active. The `proving-autoscale` sidecar
on the scheduler monitors the queue and sets:

```text
desired = min(maxReplicas, max(1, waiting + active))
```

Scale-up starts immediately because queued work waits for capacity. Scale-down
waits for `scaleDownAfterSeconds`. The worker count reaches the maximum during
`prove-digest`, which adds all batches to the queue at one time. The worker
count decreases during `prove-merge` as the tree converges. `from-file` and
`trace-digest` do not add jobs to the queue. Therefore, the cluster remains at
zero workers during the long single-threaded stage.

`maxReplicas` directly controls the machine count. Each replica uses one
complete node. Runbook `2c` sets 32 replicas for a devnet-scale ledger with
approximately 92,000 accounts. Set this value for the selected ledger size.

## Recover a checkpoint

After a restart, the scheduler can restore a compatible checkpoint. Verify the
restored state before work continues. If the checkpoint is absent or invalid,
rebuild the lifecycle. Use these commands to inspect the result of a
preemption. You can also clear a checkpoint that does not match the ledger.

```bash
dotenvx run -f apps/cli/.env.<family> -- \
  pnpm run cli -- staking-ledger-to-voting-ledger checkpoint-restore \
  --lifecycle-id <id> \
  --expected-ledger-hash <hash from the lifecycle pointer> \
  --s3-uri s3://<sqlite bucket>/<network>

dotenvx run -f apps/cli/.env.<family> -- \
  pnpm run cli -- staking-ledger-to-voting-ledger checkpoint-clean \
  --lifecycle-id <id> \
  --s3-uri s3://<sqlite bucket>/<network>
```

`--expected-ledger-hash` is mandatory. The command checks this value. A
checkpoint can resume only with its source ledger. Thus, a restore cannot apply
the progress of one lifecycle to a different lifecycle. Get the hash from the
`lifecycle-<id>.hash` pointer that the scheduler received. For a completed
lifecycle, the `.done` marker contains the same hash.

Pass the SQLite network prefix to `--s3-uri`. The CLI adds the
`.checkpoints/` sub-prefix. Do not include `.checkpoints` in the argument.

`checkpoint-clean` deletes the checkpoints for one lifecycle. The scheduler
deletes these checkpoints after `trace-digest` completes and before it writes
`.done`. Run `checkpoint-clean` only when a checkpoint is stale or unusable.
The next attempt then starts without a checkpoint.

## Monitor a build

```bash
kubectl logs -n <namespace> deploy/decentralized-treasury-voting-ledger-scheduler \
  -c voting-ledger-scheduler -f

kubectl logs -n <namespace> deploy/decentralized-treasury-proving-scheduler \
  -c proving-scheduler -f

kubectl logs -n <namespace> deploy/decentralized-treasury-proving-scheduler \
  -c proving-autoscale -f
```

Check the worker count to identify the current proving state:

```bash
kubectl get deploy -n <namespace> decentralized-treasury-proving-worker
```

`0/0` means that the queue has no work. During `trace-digest`, this state is
correct. It does not show a stalled process.

The scheduler pod runs these sidecars:

- `s3-sync`, which pulls data;
- `s3-push-markers`;
- `s3-push-proofs`;
- `serve-artifacts`, which is the nginx server for `/sqlite` and `/proofs`;
- `proving-autoscale`.

Use these names when you examine events.

## Troubleshooting

| Symptom                                                              | Cause / fix                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No progress occurs, and workers are at `0/0`                         | This state is normal during `from-file` and `trace-digest`, which do not add jobs to the queue. Check the voting-ledger-scheduler log for the traced index count.                                                                                     |
| An available lifecycle has no `.done` marker                         | Confirm that its `lifecycle-<id>.hash` pointer and hash-named ledger payload are present. Check its failure marker and retry backoff. The scheduler processes all eligible pointers newest-first during each poll.                                    |
| Proving stops on an old lifecycle                                    | The scheduler uses strict oldest-first order. Thus, one unprovable lifecycle blocks each later lifecycle. Correct the lifecycle. As a last resort, write its `.proven` marker manually and include a reason. This operation bypasses the normal flow. |
| `trace-digest` restarts at zero after an eviction                    | `checkpoint.intervalIndices` is `0`. Set a nonzero value before you use spot capacity.                                                                                                                                                                |
| The queue is empty after a Redis restart, and queue progress is lost | `proving.redis.persistence.enabled` is disabled. Proofs in SQLite remain, but the queue does not remain.                                                                                                                                              |
| `/sqlite` and `/proofs` return 502                                   | The proving-scheduler Service is absent. See the `extraObjects` workaround in `2c`.                                                                                                                                                                   |
| S3 and local sizes are different                                     | An upload can be active, or a sidecar can be between push cycles. Wait for one push cycle. Use the S3 multipart-upload list to identify an incomplete upload.                                                                                         |

## References

- Compose equivalent: `devops/TESTNET.md`, "Lifecycle Data And Proofs"
- Chart: <https://github.com/MinaFoundation/helm-charts/tree/main/decentralized-treasury>
  (`scripts/proving-autoscale.mjs` is the autoscaler)
- Previous: `2c-Deploy-Stack`
