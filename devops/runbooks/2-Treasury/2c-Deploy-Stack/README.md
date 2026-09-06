# 2c — Deploy Stack

This runbook deploys the treasury stack and verifies the deployment. Runbook
`2b` completes all on-chain operations before this procedure. This cluster
deployment is equivalent to `pnpm testnet:up` for a local deployment.

## Prerequisites

Get these values and artifacts from runbook `2b`:

- the **treasury owner address** from `treasury-owner deploy`;
- the deployment **block height**;
- the `verification-keys.yaml` file in this directory, with values from the
  `browserEnv` output of `treasury-owner compile`;
- a funded treasury with a balance that the applications can show.

## 1. Deploy the stack

### Fill in the placeholders

Set each `<REPLACE: ...>` value in `helmfile.yaml` before deployment:

| Value                                        | From                                                    |
| -------------------------------------------- | ------------------------------------------------------- |
| `host`                                       | Your public hostname for the treasury UI                |
| `certificateArn`                             | Your TLS certificate                                    |
| `namespace`, `minaNodeUpstream`              | The namespace holding `graphql-proxy` (runbook `1b`)    |
| `s3.region`, `sqliteBucket`, `proofsBucket`  | Buckets for lifecycle SQLite and proofs                 |
| `externalDatabase.host` / `password`         | Your managed database                                   |
| `proving.redis.persistence.storageClass`     | A storage class for the proving queue volume (see `2d`) |
| `config.treasuryOwnerContractAddress`        | `treasury-owner deploy` output (`2b`)                   |
| `config.treasuryDeployedAtSlot`              | The value `2b` deployed with                            |
| `indexer.extraEnvVars` `EVENTS_START_HEIGHT` | Just below the deploy block height (`2b`)               |

Confirm that `verification-keys.yaml` contains all required values. Without
these values, the web application cannot create, vote, tally, or execute
proposals.

### Use a managed database

The helmfile sets `postgresql.enabled: false`. The `externalDatabase` value
identifies a managed instance such as RDS or Cloud SQL.

The database stores proposal text. Mina does not store the proposal text
on-chain. If the bundled Postgres volume is lost, the proposal text is lost.
The on-chain proposal record remains, but its text is not available. A managed
database is independent of the cluster. The managed database also supplies
backups and point-in-time restore.

Enable exactly one database option. The helmfile contains the bundled option as
a commented block. Use a password method that is valid for the environment.
Examples include a plain value, a sealed secret, or an external-secrets
operator.

### Use spot capacity

Spot capacity is the preferred option for this stack for these reasons:

- **The workloads include restart and resume mechanisms.** The schedulers read
  S3 markers. `trace-digest` creates a checkpoint after each 500 indices. The
  lifecycle SQLite file stores computed proofs. BullMQ can requeue a stalled
  job. The APIs are stateless. These mechanisms reduce repeated work, but they
  do not guarantee recovery from each interruption. Verify the artifacts after
  an interruption. Rebuild a lifecycle if its SQLite state or marker state is
  invalid. Runbook `2d` gives the recovery details.
- **The compute load is expensive and intermittent.** During `prove-digest`, the
  proving cluster can use up to 32 nodes. Each node has 16 or more vCPUs. Between
  lifecycles, `minReplicas: 0` releases all proving nodes. Spot capacity reduces
  the cost of this interruptible compute load.

The helmfile sets a `nodeSelector` and `tolerations` on each workload. **The
nodes must have the specified labels before Kubernetes can schedule the
workloads.** The supplied values use Karpenter keys. These keys exist only in a
cluster that uses Karpenter:

```yaml
nodeSelector:
  karpenter.sh/nodepool: amd64-spot
  karpenter.sh/capacity-type: spot
tolerations:
  [{ key: karpenter.sh/nodepool, operator: Exists, effect: NoSchedule }]
```

First, examine the labels on the nodes:

```bash
kubectl get nodes --show-labels | tr ',' '\n' | grep -iE "capacity|spot|preempt"
```

Most managed platforms add labels to spot capacity. Confirm the labels in the
cluster. Do not use the table without this confirmation:

| Platform               | Label                                        |
| ---------------------- | -------------------------------------------- |
| Karpenter              | `karpenter.sh/capacity-type=spot`            |
| EKS managed node group | `eks.amazonaws.com/capacityType=SPOT`        |
| GKE Spot VMs           | `cloud.google.com/gke-spot=true`             |
| AKS spot               | `kubernetes.azure.com/scalesetpriority=spot` |

If the nodes do not have suitable labels, add a label and a taint:

```bash
kubectl label node <node> workload=treasury-spot
kubectl taint node <node> workload=treasury-spot:NoSchedule
```

The label selects these nodes for the pods. The **taint prevents other workloads
from using these nodes**. Therefore, an interruption affects only workloads
that accept spot interruptions. Match the label and taint in the values:

```yaml
nodeSelector:
  workload: treasury-spot
tolerations:
  - key: workload
    operator: Equal
    value: treasury-spot
    effect: NoSchedule
```

If the cluster does not use Karpenter, make these two changes:

- `proving.worker.affinity` uses `karpenter.k8s.aws/instance-cpu` to require at
  least 16 vCPUs. Other clusters do not have this key. Because the rule is
  `required...`, each worker remains `Pending`. Replace the key with a label
  that the nodes supply. For example, use `node.kubernetes.io/instance-type`
  with an explicit list of sizes. You can also remove the `nodeAffinity` block.
  Keep `podAntiAffinity` to prevent two workers from sharing one host.
- `votingLedgerScheduler` and `proving.worker` define their own scheduling
  values. They do not inherit the chart-wide values. Apply the scheduling
  change in all three locations.

Do not run the database on spot capacity. This restriction has no effect while
`postgresql.enabled: false`. If you enable the bundled subchart, use on-demand
nodes for the database. The database volume is zonal.

### Check other settings

- **Set `EVENTS_START_HEIGHT`.** Without this value, a new indexer starts at
  genesis. The pending path does not run before this first pass finishes. During
  this pass, the indexer does not index new data and cannot attach proposal
  content. An existing cursor takes precedence over `EVENTS_START_HEIGHT`.
  Therefore, this value affects only a database that does not have an indexer
  cursor.
- **Select the chart reference.** Use `decentralized-treasury-0.2.5` for devnet
  or mainnet. For the 21-lifecycles-per-epoch speed test, use the
  `spike/decentralized-treasury-lifecycle-speedrun` branch. This value is a
  branch, not a tag. Thus, a render can include chart changes that the operator
  did not select.
- **Configure `serviceAccount.annotations`.** The example contains an AWS IRSA
  role. On other cloud platforms, remove this annotation and use a different
  method to grant S3 access.
- **Configure `ingress.annotations`.** The supplied annotations are specific to
  AWS ALB. Replace the annotations for the selected ingress controller.

### Apply

```bash
cd devops/runbooks/2-Treasury/2c-Deploy-Stack
helmfile template . | kubectl diff -f -
helmfile template . | kubectl apply -f -
```

Read the complete diff before you apply it. This deployment does not use
ArgoCD. No automatic reconciliation occurs. The apply command starts the
deployment.

`image.tag: latest` is mutable. **A second apply after the publication of a new
image does not change the deployment.** The tag string remains identical, so
Kubernetes does not detect a pod-template change. Use this command to force a
new image pull:

```bash
kubectl rollout restart deploy -n <namespace> -l app.kubernetes.io/instance=decentralized-treasury
```

## 2. Test

First, check the pods:

```bash
kubectl get pods -n <namespace> | grep decentralized-treasury
```

Confirm that `api`, `indexer`, `indexer-api`, `processor`, `processor-api`,
`proving-scheduler`, `proxy`, `web`, and `redis` are Running. Confirm that
`api-migrate` is Complete. When no proof work exists, `proving-worker` has 0
replicas. This state shows that the autoscaler is at rest. It is not a failure.

Then, confirm that each public endpoint returns `200`:

```bash
H=https://<your host>
for p in /healthz /api/healthz /indexer/healthz /indexer/status \
         /processor/healthz /processor/status; do
  printf "%-22s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "$H$p"
done
```

The two `/status` endpoints show operational progress. The health endpoints
show only that the services are running:

```bash
curl -s "$H/indexer/status"
```

```json
{
  "ok": true,
  "archive": {
    "canonicalMaxBlockHeight": 552840,
    "pendingMaxBlockHeight": 553130
  },
  "pendingCursor": 553130,
  "canonicalCursor": 552840,
  "remainingPendingBlocks": 0,
  "remainingCanonicalBlocks": 0
}
```

When `remainingPendingBlocks` and `remainingCanonicalBlocks` are `0`, the
indexer has processed the archive data. On a new deployment, a large value that
decreases slowly usually shows an unset or low `EVENTS_START_HEIGHT`.

```bash
curl -s "$H/processor/status"
```

```json
{
  "ok": true,
  "processorName": "proposal-processor",
  "offset": { "lastSeenEventId": "3238", "updatedAt": "..." },
  "remainingEvents": 0
}
```

Finally, open `https://<your host>`. Confirm that the UI loads and shows the
treasury state. If the page loads but proposal actions fail, check the
verification keys. The keys can be absent or compiled with a different
`LIFECYCLE_PERIOD_DURATION`.

## Troubleshooting

| Symptom                                               | Cause / fix                                                                                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All ingress routes return 502                         | The proving-scheduler Service is absent. nginx does not start when it cannot resolve the upstream. Keep the `extraObjects` workaround.                         |
| `/mina/graphql` returns 502, but other routes respond | `minaNodeUpstream` must be an FQDN, not a Service name without a domain.                                                                                       |
| The UI loads, but proposal actions fail               | `verification-keys.yaml` is empty, or the keys use an incorrect network or duration.                                                                           |
| The indexer does not process all archive data         | `EVENTS_START_HEIGHT` is unset, so the indexer starts at genesis.                                                                                              |
| Pods show `CreateContainerConfigError`                | The `securityContext.runAsUser: 1000` workaround is absent.                                                                                                    |
| Pods remain `Pending`                                 | The nodes do not have the `nodeSelector` label, or the taint does not have a matching toleration. Check `kubectl describe pod`. Then, see "Use spot capacity". |
| Only `proving-worker` remains `Pending`               | Its `nodeAffinity` requires the Karpenter-only `karpenter.k8s.aws/instance-cpu` key. Replace or remove this rule.                                              |
| A second apply does not deploy new code               | The `latest` tag string did not change. Start a rollout restart.                                                                                               |

## References

- Happy path: `devops/TESTNET.md` §7
- Chart: <https://github.com/MinaFoundation/helm-charts/tree/main/decentralized-treasury>
- Images: <https://hub.docker.com/u/minafoundation>
- Previous: `2b-Deploy-Contracts` · Next: `2d-Lifecycle-Pipeline`
