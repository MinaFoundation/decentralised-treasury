# 2c — Deploy Stack

One command, then a verification pass. Everything on-chain already happened in
`2b`; this runs the treasury stack in the cluster and is the equivalent of
`pnpm testnet:up` for a local run.

## Prerequisites

From `2b`:

- the **treasury owner address** emitted by `treasury-owner deploy`
- the **block height** that deploy landed at
- `verification-keys.yaml` in this directory, populated from the `browserEnv`
  output of `treasury-owner compile`
- a treasury that has been funded, so there is something to show

## 1. Deploy The Stack

### Fill in the placeholders

Every `<REPLACE: ...>` in `helmfile.yaml` must be set first:

| Value | From |
| --- | --- |
| `host` | Your public hostname for the treasury UI |
| `certificateArn` | Your TLS certificate |
| `namespace`, `minaNodeUpstream` | The namespace holding `graphql-proxy` (runbook `1b`) |
| `s3.region`, `sqliteBucket`, `proofsBucket` | Buckets for lifecycle SQLite and proofs |
| `externalDatabase.host` / `password` | Your managed database |
| `proving.redis.persistence.storageClass` | A storage class for the proving queue volume (see `2d`) |
| `config.treasuryOwnerContractAddress` | `treasury-owner deploy` output (`2b`) |
| `config.treasuryDeployedAtSlot` | The value `2b` deployed with |
| `indexer.extraEnvVars` `EVENTS_START_HEIGHT` | Just below the deploy block height (`2b`) |

Also confirm `verification-keys.yaml` is filled in. Without it the web app
cannot create, vote, tally or execute proposals.

### Use a managed database

The helmfile ships with `postgresql.enabled: false` and `externalDatabase`
pointed at a managed instance (RDS, Cloud SQL, ...) on purpose.

Proposal text is held in this database, not on-chain. If the volume behind a
bundled Postgres is lost, that content is gone — the on-chain record survives,
but what each proposal actually *said* does not. A managed database survives the
cluster and brings backups and point-in-time restore with it.

Exactly one of the two may be enabled — the helmfile carries the bundled
alternative as a commented block if you want it instead. How the password gets
into the values is your environment's business: a plain value, a sealed secret,
an external-secrets operator, whatever you already use.

### Run it on spot

Spot is the preferred way to run this stack, for two reasons that reinforce each
other:

- **Everything here is restartable.** The schedulers resume from their S3
  markers, `trace-digest` checkpoints every 500 indices, already-computed proofs
  are persisted in the lifecycle's sqlite, BullMQ requeues a job whose worker
  vanished, and the APIs are stateless. An interruption costs time, not work.
  Runbook `2d` covers the mechanics.
- **The compute is expensive and bursty.** During `prove-digest` the proving
  cluster wants up to 32 nodes of 16+ vCPU each, and between lifecycles it wants
  none — `minReplicas: 0` releases them. Paying on-demand for a burst that large,
  on work that tolerates being interrupted, is money for nothing.

The helmfile expresses this with a `nodeSelector` and `tolerations` on every
workload. **Those are labels on your nodes, and nothing schedules until the
nodes actually carry them.** The shipped values use Karpenter's keys, which
exist only if you run Karpenter:

```yaml
nodeSelector:
  karpenter.sh/nodepool: amd64-spot
  karpenter.sh/capacity-type: spot
tolerations: [{key: karpenter.sh/nodepool, operator: Exists, effect: NoSchedule}]
```

Start by seeing what your nodes already advertise:

```bash
kubectl get nodes --show-labels | tr ',' '\n' | grep -iE "capacity|spot|preempt"
```

Most managed platforms label spot capacity for you. Confirm against your own
cluster rather than trusting the table:

| Platform | Label |
| --- | --- |
| Karpenter | `karpenter.sh/capacity-type=spot` |
| EKS managed node group | `eks.amazonaws.com/capacityType=SPOT` |
| GKE Spot VMs | `cloud.google.com/gke-spot=true` |
| AKS spot | `kubernetes.azure.com/scalesetpriority=spot` |

If nothing suitable exists, label and taint the nodes yourself:

```bash
kubectl label node <node> workload=treasury-spot
kubectl taint node <node> workload=treasury-spot:NoSchedule
```

The label is what attracts these pods; the **taint is what keeps everything else
off those nodes**, so an interruption only takes down workloads that expect it.
Then match both in the values:

```yaml
nodeSelector:
  workload: treasury-spot
tolerations:
  - key: workload
    operator: Equal
    value: treasury-spot
    effect: NoSchedule
```

Two things to fix up if you are not on Karpenter:

- `proving.worker.affinity` floors the instance at 16 vCPU using
  `karpenter.k8s.aws/instance-cpu`. That key will not exist, and because the rule
  is `required...`, every worker stays `Pending`. Replace it with something your
  nodes do expose — `node.kubernetes.io/instance-type` with an explicit list of
  sizes — or drop the `nodeAffinity` block and keep only the `podAntiAffinity`,
  which is what actually stops two workers sharing a host.
- `votingLedgerScheduler` and `proving.worker` each restate scheduling rather
  than inheriting the chart-wide values, so a change has to be made in all three
  places.

The one workload that does *not* want spot is a database. That is moot while
`postgresql.enabled: false`, but if you switch to the bundled subchart, give it
on-demand nodes and remember its volume is zonal.

### Other things to check

- **`EVENTS_START_HEIGHT` matters.** Without it a cold indexer walks from
  genesis. That is not merely slow: until the pass finishes the pending path
  does not run, so nothing new is indexed and proposal content attachment
  cannot succeed at all. An existing cursor always wins, so it only has any
  effect on a database that has not indexed yet.
- **Chart ref.** `decentralized-treasury-0.2.5` for devnet or mainnet. For the
  21-lifecycles-per-epoch speedrun, point at the
  `spike/decentralized-treasury-lifecycle-speedrun` branch instead — a branch,
  not a tag, so a render can pick up chart changes you did not make.
- **`serviceAccount.annotations`** carries an AWS IRSA role in the example.
  Remove it entirely on other clouds and grant the S3 access another way.
- **`ingress.annotations`** are AWS ALB specific. Replace them to match your
  own ingress controller.

### Apply

```bash
cd devops/runbooks/2-Treasury/2c-Deploy-Stack
helmfile template . | kubectl diff -f -
helmfile template . | kubectl apply -f -
```

Read the diff in full before applying. There is no ArgoCD — nothing reconciles
on its own, and nothing is deployed until this apply runs.

`image.tag: latest` is mutable, so **a re-apply after a new image is published
changes nothing** — the tag string is identical, so Kubernetes sees no change to
the pod template. Force the pull:

```bash
kubectl rollout restart deploy -n <namespace> -l app.kubernetes.io/instance=decentralized-treasury
```

## 2. Test

Pods first:

```bash
kubectl get pods -n <namespace> | grep decentralized-treasury
```

Expect `api`, `indexer`, `indexer-api`, `processor`, `processor-api`,
`proving-scheduler`, `proxy`, `web` and `redis` Running, `api-migrate`
Complete, and `proving-worker` at 0 replicas when there is nothing to prove —
that is the autoscaler at rest, not a failure.

Then the public endpoints, all of which should return `200`:

```bash
H=https://<your host>
for p in /healthz /api/healthz /indexer/healthz /indexer/status \
         /processor/healthz /processor/status; do
  printf "%-22s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "$H$p"
done
```

The two `/status` endpoints are the ones that actually tell you the stack is
working, not merely up:

```bash
curl -s "$H/indexer/status"
```

```json
{"ok":true,"archive":{"canonicalMaxBlockHeight":552840,"pendingMaxBlockHeight":553130},
 "pendingCursor":553130,"canonicalCursor":552840,
 "remainingPendingBlocks":0,"remainingCanonicalBlocks":0}
```

`remainingPendingBlocks` and `remainingCanonicalBlocks` at `0` mean the indexer
has caught up with the archive. A large, slowly-falling number on a fresh
deployment usually means `EVENTS_START_HEIGHT` is unset or far too low.

```bash
curl -s "$H/processor/status"
```

```json
{"ok":true,"processorName":"proposal-processor",
 "offset":{"lastSeenEventId":"3238","updatedAt":"..."},"remainingEvents":0}
```

Finally open `https://<your host>` and confirm the UI loads and shows treasury
state. If the page renders but proposal actions fail, the verification keys are
missing or were compiled at a different `LIFECYCLE_PERIOD_DURATION`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Whole ingress 502s | The proving-scheduler Service is missing — nginx refuses to boot on an unresolvable upstream. Keep the `extraObjects` workaround. |
| `/mina/graphql` 502s, other routes fine | `minaNodeUpstream` must be an FQDN, not a bare Service name. |
| UI loads, proposals fail | `verification-keys.yaml` empty, or keys from the wrong network or duration. |
| Indexer never catches up | `EVENTS_START_HEIGHT` unset, so it is walking from genesis. |
| Pods `CreateContainerConfigError` | The `securityContext.runAsUser: 1000` workaround was dropped. |
| Pods stay `Pending` | The nodes carry no label matching `nodeSelector`, or the taint has no matching toleration. Check with `kubectl describe pod`, then see "Run it on spot". |
| Only `proving-worker` stays `Pending` | Its `nodeAffinity` requires the Karpenter-only `karpenter.k8s.aws/instance-cpu` key. Replace or remove that rule. |
| Re-apply deploys no new code | `latest` is unchanged as a string. Roll out a restart. |

## References

- Happy path: `devops/TESTNET.md` §7
- Chart: <https://github.com/MinaFoundation/helm-charts/tree/main/decentralized-treasury>
- Images: <https://hub.docker.com/u/minafoundation>
- Previous: `2b-Deploy-Contracts` · Next: `2d-Lifecycle-Pipeline`
