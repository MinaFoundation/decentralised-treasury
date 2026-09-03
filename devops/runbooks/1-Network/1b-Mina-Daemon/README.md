# 1b — Mina Daemon

Deploy after the archive node (`1a`). The daemon is what actually connects to
the network; the archive is useless without one feeding it.

Two releases live in this runbook's `helmfile.yaml`: the daemon itself, and the
`graphql-proxy` Service and Ingress that expose its GraphQL endpoint.

## What It Does

`node-0` is a plain full node — it produces no blocks and does no SNARK work. It
gossips with peers, validates the chain, and serves two things:

- **blocks to the archive node**, over the archive RPC at `archive:3086`
- **GraphQL on `:3085`**, which the treasury CLI and browser use to read account
  state and submit zkApp transactions

```text
  network peers <--p2p 10801--> node-0 (mina) --(archive:3086)--> archive-node
                                     |
                                     +-- :3085 graphql --> graphql-proxy --> treasury
```

Everything the treasury sends on-chain goes through this daemon, and everything
the archive stores was received by it. If it is not `Synced`, both stop.

## Components

| Component | Object | Role |
| --- | --- | --- |
| Daemon | `Deployment/node-0`, container `mina` | The Mina node itself |
| Public proxy | container `graphql-public-proxy` (same pod, `:3000`) | Read-only GraphQL filter for public exposure |
| Daemon service | `Service/node-0` | p2p `10801`, client `8301` |
| GraphQL service | `Service/node-0-graphql` | `3085` (graphql), `3000` (proxy) |
| libp2p keys | init container + secret | Generated on first start (`libp2pKeys.create: true`) |
| Proxy service | `Service/graphql-proxy` | Selects pods labelled `exposeGraphql: "true"` — no workload of its own |
| Proxy ingress | `Ingress/graphql-proxy` | Public HTTPS entry point. Example values only, see step 2 |

**There is no PVC.** The ledger is ephemeral, so every restart is a full resync
from peers, not a resume — budget for it before restarting anything.

- Charts: <https://github.com/MinaFoundation/helm-charts.git> — `mina-daemon`
  (pinned `mina-daemon-2.1.1`) and `raw` for the proxy objects
- Image tag: the release announcement for the network in
  <https://github.com/MinaProtocol/mina/discussions> (see step 1)
- Values: `helmfile.yaml` in this directory

## Prerequisites

- Runbook `1a` applied: `Service/archive` resolves on `:3086`.
- `kubectl` on the `production` cluster, namespace `devnet`.
- Enough headroom for a 16Gi / 4 CPU request on the target nodepool.
- A DNS name and a TLS certificate, if the endpoint is to be public.

## 1. Pick The Image Tag

Must be the same build as the archive node (`1a`), otherwise the archive
silently rejects blocks.

Tags come from the official release announcement for the network, published in
<https://github.com/MinaProtocol/mina/discussions>. Devnet 4.0.0 "Mesa" is
<https://github.com/MinaProtocol/mina/discussions/19236>. Keep that page open —
it also publishes the git commit SHA and the chain id that step 5 verifies
against.

```text
minaprotocol/mina-daemon:4.0.0-6965b50-<codename>-devnet
```

`<codename>` is the base OS — focal, jammy, noble, bullseye or bookworm. This
helmfile uses `bookworm`, so `4.0.0-6965b50-bookworm-devnet`.

Cross-check against the archive node:

```bash
kubectl get deploy -n devnet archive-node \
  -o jsonpath='{.spec.template.spec.containers[*].image}{"\n"}'
```

## 2. Check The Values That Matter

| Value | Current | Why |
| --- | --- | --- |
| `deployment.testnet` / `peerListURL` | `devnet` / devnet bootnodes | Wrong pair = wrong chain id, and nothing peers |
| `node.archive.enabled` / `address` | `true` / `archive:3086` | The whole point. `archive` is the Service name from `1a` |
| `node.exposeGraphql` | `true` | Adds the `exposeGraphql: "true"` pod label the proxy Service selects. Without it the proxy has no endpoints |
| `podLabels.queryableNode` | `"true"` | Required by the staking ledger provider (`1c`) |
| `node.libp2pKeys.create` | `true` | Generates a keypair on first start |
| `readinessProbe.initialDelaySeconds` | `120` | Chart default is `1200`, which left the pod unready long after it was actually Synced |
| `resources` | 16Gi/4 → 24Gi/6 | Below this the daemon is OOM-killed mid-catchup |

**The Ingress carries `<REPLACE: …>` placeholders.** Fill in the host and the
certificate ARN, and adjust the annotations to your ingress controller, before
applying — they are written to be obviously wrong rather than silently wrong.
Delete the Ingress resource entirely if the endpoint stays internal; the Service
alone is enough for the treasury.

Two things to check against the live release: `nodeSelector` / `tolerations`
(the daemon is meant to land on the `mina-daemon-spot` nodepool) and the
`serviceAccount` role annotation. Dropping them does not fail the apply — it
just schedules the pod somewhere else.

Note the chart reads `node.fileLogLevel`; a `filelogLevel` key is silently
ignored and the default (`Error`) applies.

## 3. Diff, Then Apply

```bash
cd devops/runbooks/1-Network/1b-Mina-Daemon
helmfile template . | kubectl diff -f -
helmfile template . | kubectl apply -f -
```

The update strategy is `Recreate`, so applying any pod-template change stops the
node before starting the new one. The archive keeps whatever it already has and
the guardian backfills the gap on its next hourly run.

## 4. Wait For Sync

```bash
kubectl get pods -n devnet -l app=node-0 -w
```

The pod reports `Ready` only once the readiness probe sees `Synced` — the probe
is literally `mina client status --json | jq -r .sync_status`. Expect
bootstrap → catchup → synced to take a while on a cold start, since there is no
persisted ledger.

## 5. Check The Daemon Status

This is the command to reach for, every time:

```bash
kubectl exec -n devnet deploy/node-0 -c mina -- mina client status
```

Four lines decide whether the node is healthy:

```text
Git SHA-1:                                     6965b502ecd7959d50e4a9116529406ed44e85a8
Chain id:                                      ebfce0d570bc22eb041e1a7b0a46bbc3ed5d0a1030ef2ab5e36eef908b93eba8
Peers:                                         26
Sync status:                                   Synced
```

- **Git SHA-1** — must match the image tag's build commit, as published on the
  release page for that tag (e.g. <https://github.com/MinaProtocol/mina/discussions/19236>).
  A mismatch means the running binary is not the one you think you deployed.
- **Chain id** — must match exactly the value published on the same release
  page for the image tag in use. A different value means the daemon joined a
  different network: wrong image, wrong `testnet`, or wrong peer list. Unless it
  happens to reach a seed node on that other network, it will fail to connect
  to any peers at all rather than look healthy — but if it does connect, it is
  perfectly healthy and useless.
- **Peers** — must be well above zero and stable. A node with 0–2 peers is
  isolated; check the peer list URL and egress before anything else.
- **Sync status** — must be `Synced`. `Bootstrap` or `Catchup` means it is still
  working; `Offline` means it has lost the network.

`Block height` should also advance between two runs a minute apart, and stay
close to `Max observed block height`.

## 6. Check GraphQL

Directly on the daemon:

```bash
kubectl exec -n devnet deploy/node-0 -c mina -- bash -c \
  'curl -s -X POST http://localhost:3085/graphql -H "content-type: application/json" \
     -d "{\"query\":\"{ syncStatus daemonStatus { blockchainLength } }\"}"'
```

Expect `{"data":{"syncStatus":"SYNCED","daemonStatus":{"blockchainLength":…}}}`,
with a length matching `Block height` above.


Finally, through the Ingress, which is what actually exposes the endpoint
externally:

```bash
curl -s -X POST https://<REPLACE: ingress host>/graphql \
  -H "content-type: application/json" \
  -d '{"query":"{ syncStatus daemonStatus { blockchainLength } }"}'
```

If this fails while the in-cluster checks above succeed, the problem is the
Ingress itself — the `<REPLACE: …>` host/certificate placeholders, the
controller annotations, or DNS — not the daemon or the proxy Service.

## 7. Confirm The Archive Is Being Fed

Run this twice, a minute apart — `max_height` must move:

```bash
kubectl exec -n devnet archive-postgresql-0 -- bash -c \
  'PGPASSWORD=$POSTGRES_PASSWORD psql -U $POSTGRES_USER -d archive \
     -c "SELECT max(height) FROM blocks;"'
```

A frozen height with a `Synced` daemon means the archive link is broken, not the
chain — check `node.archive.address` and that `archive-node` is Running.

## 8. Hand Off To The Treasury

The treasury reaches the daemon through the proxy Service, never the pod. Use
the FQDN — a bare name fails to resolve in the nginx `/mina/` route:

```yaml
minaNodeUpstream: http://graphql-proxy.devnet.svc.cluster.local:3085
```

The browser needs the public URL instead, the one on the Ingress host:

```text
NEXT_PUBLIC_MINA_NODE_URL=https://devnet.minaprotocol.network/graphql
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Peers: 0` | Wrong or unreachable `peerListURL`, or blocked egress. Check the URL resolves from inside the pod. |
| Chain id differs | Wrong network for the image or peer list. Fix the pair, do not restart and hope. |
| Stuck in `Bootstrap`/`Catchup` | Normal on a cold start (no PVC). If it persists, check memory limits — an OOM kill mid-catchup restarts the whole resync. |
| Pod not `Ready` but status says `Synced` | Readiness probe timing. Confirm `readinessProbe.initialDelaySeconds` is `120`, not the chart default `1200`. |
| Archive height frozen, daemon Synced | `node.archive.address` wrong, or `archive-node` down. The archive address is a start argument — restart the daemon after fixing it. |
| Pod `Pending` | 16Gi/4 CPU request has nowhere to land. Check `nodeSelector`/`tolerations` against the nodepool. |
| `graphql-proxy` has no endpoints | `node.exposeGraphql` is not `true`, or `node-0` is not Ready. |
| Ingress up but no certificate | The `<REPLACE: …>` ARN placeholder was applied as-is. |

## References

- Charts: <https://github.com/MinaFoundation/helm-charts/tree/main/mina-daemon>, <https://github.com/MinaFoundation/helm-charts/tree/main/raw>
- Local equivalent: `devops/TESTNET_MINA_NODE.md`
- Previous: `1a-Archive-Node` · Next: `1c-Staking-Ledger-Provider`
