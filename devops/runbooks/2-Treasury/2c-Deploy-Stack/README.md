# 2c — Deploy Stack

This runbook deploys the treasury stack and verifies the deployment. Runbook
`2b` completes all on-chain operations before this procedure. This cluster
deployment is equivalent to `pnpm testnet:up` for a local deployment.

## Prerequisites

Use replacement image tags whose layers have been checked for environment files.
The September audit identified `minafoundation/dt-api:41c4809` and `minafoundation/dt-api:265b1c9` as affected images.
Do not use these references. Older images and registry caches need separate inspection.
Follow the inventory and cleanup procedure in `devops/PUBLISHING.md`.

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
| `config.multisigParticipantsPublicKeys`      | The five ordered signers `2b` deployed with             |
| `indexer.extraEnvVars` `EVENTS_START_HEIGHT` | Just below the deploy block height (`2b`)               |
| `backofficeHost`                             | Hostname for the break-glass console                    |
| `backoffice.auth.basic.users`                | Credentials for the console                             |

Confirm that `verification-keys.yaml` contains all required values. Without
these values, the web application cannot create, vote, tally, or execute
proposals. Both browser applications need them - give the file a `backoffice`
block as well as a `web` one, or the console cannot prove a pause, unpause,
proposal toggle or key rotation.

### Complete the chart security migration before deployment

The checked-in Helmfile pins exact published source commit
`c648c68ab8ee1f1cb2a88e91c022411aafcb82f2` from
[PR 346](https://github.com/MinaFoundation/helm-charts/pull/346). This makes
source review and rendering deterministic before a release tag exists. The PR
still needs the required reviews, merge, and a release tag. This pin does not
claim that the chart was released or deployed. Complete those gates and the
security migration below before a rollout. Do not select a moving branch or an
unverified release tag.

The new chart separates each workload identity and the public artifact server.
Configure cloud roles through `serviceAccounts.<component>.annotations`:

| Component | Cloud permissions |
| --- | --- |
| `api`, `processor` | List and read the required SQLite prefix. No writes. |
| `tally-scheduler`, if enabled | List and read the required SQLite and proof prefixes. No writes. |
| `voting-ledger-scheduler` | Read its ledger source; write its SQLite, marker, and checkpoint prefixes. |
| `proving-scheduler` | Read its inputs; write its completed SQLite, proof, and marker prefixes. |
| Other workloads, including public servers | No cloud credentials. |

For example, replace the role placeholders in the reviewed chart values:

```yaml
serviceAccount:
  annotations: {}
  automount: false
serviceAccounts:
  api:
    annotations:
      eks.amazonaws.com/role-arn: <READ_ONLY_SQLITE_ROLE>
  processor:
    annotations:
      eks.amazonaws.com/role-arn: <READ_ONLY_SQLITE_ROLE>
  voting-ledger-scheduler:
    annotations:
      eks.amazonaws.com/role-arn: <LEDGER_PIPELINE_ROLE>
  proving-scheduler:
    automount: true
    annotations:
      eks.amazonaws.com/role-arn: <PROVING_PIPELINE_ROLE>
```

Use separate cloud trust subjects for the generated account names.
Global `serviceAccount.annotations` is rejected by the new chart.
Only the proving scheduler receives Kubernetes scaling permissions and its API token, when autoscaling is enabled.
The public artifact server uses another account and read-only PVC mounts.
API and processor roles must not reuse the old writer role.

`automountServiceAccountToken: false` does not prevent a cloud identity webhook from injecting another token.
Verify actual IAM policies, trust subjects, existing RoleBindings, and pod credentials.
The chart disables EC2 metadata credential fallback in its S3 clients.
Cluster controls must also block direct node metadata access from public pods.

Before migration, save unuploaded scheduler progress and stop the old writer.
The new public artifact server shares dedicated SQLite and proof PVCs with the scheduler.
Set `proving.scheduler.persistence.size`, its storage class, and `proving.scheduler.server.proofsStorageSize`.
Both pods must fit on the same node when the claims use `ReadWriteOnce`.
Inspect storage topology and capacity before rollout. Do not delete the old data until recovery is verified.
Remove any old `extraObjects` Service override that selects the scheduler pod.
The chart supplies the stable Service name and selects the new `artifacts` pod.

The upgrade also includes changes from chart `0.4.1` through `0.9.0`:
optional automatic tally, docs routing, API/processor persistence, and S3 synchronization fixes.
Review those values. Keep automatic tally disabled unless the operator separately configures and funds it.
Select `network: mainnet` or `network: devnet` explicitly; the new default is mainnet.
CLI and proof processes receive `NETWORK`; browser processes derive `NEXT_PUBLIC_NETWORK_ID` from the same value.
Remove legacy `MINA_NETWORK_ID` and `tallyScheduler.minaNetworkId` settings.
Use verification keys compiled for that same network.

Render both charts and inspect the complete resource diff before a separately approved rollout.
Chart rendering does not verify live cloud permissions or storage scheduling.
See the chart's `SECURITY-MIGRATION.md` for the release checklist.

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
- **Select the reviewed chart commit.** Complete the chart security migration above before applying this runbook.
- **Configure per-workload cloud roles.** Give read-only roles to the API and processor. Give writer roles only to the pipeline.
- **Configure `ingress.annotations`.** The supplied annotations are specific to
  AWS ALB. Replace the annotations for the selected ingress controller.

### Apply

```bash
cd devops/runbooks/2-Treasury/2c-Deploy-Stack
helmfile template . | kubectl diff -n <namespace> -f -
helmfile template . | kubectl apply -n <namespace> -f -
```

**Pass `-n` explicitly.** `helmfile template` gives `helm` the namespace so the
templates can read it, but it does not write `metadata.namespace` into the
output. Most objects therefore come out namespace-less and land in whatever the
current kubectl context says, while the bundled Postgres subchart sets its own
namespace and lands correctly - so an unqualified apply can split one release
across two namespaces and overwrite an unrelated deployment. The command's
safety otherwise depends entirely on ambient state.

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
`proving-scheduler`, `artifacts`, `proxy`, `web`, `backoffice`, and `redis` are Running. Confirm that
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

### Check the break-glass console

The console is on its own hostname, so check it separately. The third request
is the one that matters:

```bash
B=https://<your backoffice host>
curl -s -o /dev/null -w "%{http_code}\n" "$B/"          # 200, after auth
curl -s -o /dev/null -w "%{http_code}\n" "$B/healthz"   # 200, never gated
curl -s -X POST "$B/mina/graphql" \
  -H 'content-type: application/json' -d '{"query":"{ syncStatus }"}'
```

The last one should return `{"data":{"syncStatus":"SYNCED"}}`. It proves the
proxy is serving the daemon on the console's own origin, which is what the
browser needs: the console POSTs `application/json`, so every call is
preflighted, and a node on another origin fails unless it answers CORS. The app
surfaces that as `Treasury owner account was not found: [object Object]` - a
failed fetch, not a missing account.

`/sqlite` and `/proofs` are served on the main host only, not on this one.

A `401` on `/` with `auth.mode: basic` is the correct response, and the proxy -
not the load balancer - is what issues it.

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

| Symptom                                                                     | Cause / fix                                                                                                                                                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All ingress routes return 502                                               | Check the chart Service and its `artifacts` selector. Remove obsolete `extraObjects` overrides before the security upgrade.  |
| `proxy` crash-loops, `could not build server_names_hash`                    | The console hostname is longer than one hash bucket. Fixed in chart `0.4.1`.                                                                                   |
| `proving-scheduler` shows `5/6`                                             | `PROOFS_ENABLED` does not reach that container, and its entrypoint requires it. Fixed in chart `0.4.0`; otherwise set it in `proving.scheduler.extraEnvVars`.  |
| The console reports `Treasury owner account was not found: [object Object]` | A failed fetch, not a missing account: its Mina node is on another origin and answers no CORS. Route it via `ingress.hosts.backoffice`.                        |
| One release lands across two namespaces                                     | `kubectl apply` was run without `-n`. Most objects carry no `metadata.namespace`, so they follow the current context. See "Apply".                             |
| `/mina/graphql` returns 502, but other routes respond                       | `minaNodeUpstream` must be an FQDN, not a Service name without a domain.                                                                                       |
| The UI loads, but proposal actions fail                                     | `verification-keys.yaml` is empty, or the keys use an incorrect network or duration.                                                                           |
| The indexer does not process all archive data                               | `EVENTS_START_HEIGHT` is unset, so the indexer starts at genesis.                                                                                              |
| Pods show `CreateContainerConfigError`                                      | The `securityContext.runAsUser: 1000` workaround is absent.                                                                                                    |
| Pods remain `Pending`                                                       | The nodes do not have the `nodeSelector` label, or the taint does not have a matching toleration. Check `kubectl describe pod`. Then, see "Use spot capacity". |
| Only `proving-worker` remains `Pending`                                     | Its `nodeAffinity` requires the Karpenter-only `karpenter.k8s.aws/instance-cpu` key. Replace or remove this rule.                                              |
| A second apply does not deploy new code                                     | The `latest` tag string did not change. Start a rollout restart.                                                                                               |

## References

- Happy path: `devops/TESTNET.md` §7
- Chart: <https://github.com/MinaFoundation/helm-charts/tree/main/decentralized-treasury>
- Images: <https://hub.docker.com/u/minafoundation>
- Previous: `2b-Deploy-Contracts` · Next: `2d-Lifecycle-Pipeline`

### Upgrade transaction-relative event identity

Stop the indexer and processor before migration `1790770000000-transaction-event-identity`.
Back up the database first. Run the normal migration command before starting the new workers.
The migration merges duplicate Archive identities and prefers canonical observations.
It stops for operator review if duplicate identities contain different immutable payloads.
It clears derived event rows, preserves Proposal contents, resets processor offsets, and requests projection replay.
Historical failure records for removed duplicate rows become superseded.
Existing pending rows become orphaned until the new indexer validates their branch.

Set `ENABLE_BLOCK_TRANSACTION_DETAILS=true` on the Archive API deployment, then restart its pod.
Confirm that `blocks` returns nonempty `parentHash` values.
Start the indexer, then the processor. Wait for projection replay to complete before restoring normal API traffic.
Check the existing indexer and processor status routes. Equal-height pending tips temporarily select canonical-only projection.
Pending projection resumes automatically when one complete, stable tip is available.
If replay remains `collecting` with target `0`, but legacy rows exist in
`processor_proposals`, the database has no Proposal Archive facts from which to
rebuild those rows. Restore or reindex the missing Archive facts, or restore the
database backup. Never force the replay state to `complete`.
Do not roll back this migration to recover duplicate observations. Restore the backup if the original rows are required.
