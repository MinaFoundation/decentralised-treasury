---
title: Operator Checklist
sidebar_label: Operator checklist
audience: operator
page_kind: procedure
---

# Operator Checklist

Use this checklist through preparation, deployment, and the first service
check. Complete each section when its required system state exists. Repeat the
applicable checks after an environment change.

Use this checklist across two procedures:

- [Configure the Treasury](lifecycle/configure-the-treasury.md) selects the
  values, generates environments, and creates the configuration baseline.
- [Deploy the Treasury](deployment/deploy-the-treasury.md) compiles, deploys,
  and reconciles the release.

For Kubernetes, also use the ordered
[infrastructure runbooks](infrastructure/index.md). They supply network, stack,
and pipeline checks that are specific to the cluster deployment.

This checklist does not replace either procedure.

## Toolchain

- [ ] Use the Node.js version in `.nvmrc`.
- [ ] Enable Corepack.
- [ ] Use pnpm `9.0.0`.
- [ ] Run `CI=true pnpm install --frozen-lockfile` from the repository root.

## Network and Endpoints

- [ ] Confirm the target MINA network and `MINA_NETWORK_ID`.
- [ ] Confirm the host can reach `MINA_NODE_URL` and `ARCHIVE_NODE_URL`.
- [ ] Confirm containers can reach the Mina and Archive provider endpoints.
- [ ] Confirm the browser can reach `NEXT_PUBLIC_MINA_NODE_URL`.
- [ ] Confirm the Archive endpoint contains the target MINA network.
- [ ] Record whether Mina and Archive use a provider or the Kubernetes network procedures.
- [ ] For a self-operated Mina daemon, confirm the image Git SHA, chain ID, peer count, and `SYNCED` status.
- [ ] For a self-operated Archive node, confirm that block height advances and that the gap audit succeeds.
- [ ] For a self-operated staking-ledger provider, confirm `/healthz`, `.provider-status`, and the required retained snapshot.

Compose does not start or restart Mina or Archive. Use the provider procedure
or [the Kubernetes Network runbooks](infrastructure/index.md#1-network).

## Lifecycle Configuration

- [ ] Confirm the Mina node reports the intended protocol era.
- [ ] For Mesa, confirm `7140` slots per epoch and `90000` milliseconds per slot.
- [ ] Confirm the active zkApp command limit per block. Do not assume that the temporary Mesa value `12` is permanent.
- [ ] Set `LIFECYCLE_PERIOD_DURATION` to the Mina epoch length in slots.
- [ ] Set `TREASURY_DEPLOYED_AT_SLOT` to the first slot of an epoch.
- [ ] Use the same duration for compilation, deployment, CLI, API, scheduler, and web.
- [ ] Use the same start slot for deployment, API, and scheduler.
- [ ] Confirm the target lifecycle ID for each proposal and proof.
- [ ] Count staking accounts, positive weighted delegates, and the signable weighted subset in the selected snapshot.
- [ ] Calculate vote demand for the maximum concurrent Proposal count.
- [ ] Compare demand with a measured, buffered voting-period capacity.
- [ ] Benchmark both proof pipelines with the selected ledger and vote volume.
- [ ] Complete a tally with five usable action-state history values on the target network.

Read [lifecycle configuration](lifecycle/configuration.md) before you select a
start slot. Use
[Voting Capacity and Period Sizing](lifecycle/voting-capacity-and-period-sizing.md)
for the demand and capacity checks.

## Accounts and Signing

- [ ] Confirm the funded fee payer exists on the target network.
- [ ] Confirm the Treasury Owner and Pause Controller accounts are unused.
- [ ] Set `--withdrawal-permission` or `TREASURY_WITHDRAWAL_PERMISSION` before deployment.
- [ ] Select only `proof` or `proofOrSignature`.
- [ ] Use the safe `proof` default unless emergency withdrawal is required.
- [ ] For `proofOrSignature`, keep the Owner key as an offline emergency asset.
- [ ] For `proofOrSignature`, keep Owner key custody separate from routine infrastructure access.
- [ ] Record the authorized custodians and key recovery procedure without recording a private key or recovery phrase.
- [ ] Keep the five break-glass public keys in their exact order.
- [ ] Confirm that each break-glass signer controls the applicable signing account.
- [ ] Keep break-glass signers separate from the infrastructure operator.
- [ ] Confirm each Ledger account index returns the expected public key.
- [ ] Open the Mina app and enable blind signing before a Ledger transaction.
- [ ] Require `physical-ledger` status `PASS` from the physical verification.

Do not put private keys in browser, API, or Compose environment files.

## Compile and Browser Configuration

- [ ] Compile with the selected lifecycle duration.
- [ ] Copy all six emitted `browserEnv` values to `<WEB_ENV_FILE>`.
- [ ] Copy the same values to `<BACKOFFICE_ENV_FILE>`.
- [ ] Confirm the Backoffice file has the five ordered participant public keys.
- [ ] Confirm that the web network ID identifies the target network.

The six values include the duration, three verification keys, and two empty
roots. Do not copy only the five proof values.

## Deployment Result

- [ ] Record the included Pause Controller and Treasury Owner transaction hashes.
- [ ] Query both contract addresses on the MINA network.
- [ ] Confirm the Treasury Owner stores the selected start slot.
- [ ] Confirm the Treasury Owner stores the expected Pause Controller address.
- [ ] Confirm the Pause Controller starts with `paused=false`.
- [ ] Confirm the Pause Controller commitment matches the five ordered keys.
- [ ] Confirm Treasury Owner `access` and `send` match the selected mode.
- [ ] Confirm Treasury Owner `editState=proof` and `receive=proof`.
- [ ] Confirm Treasury Owner `setPermissions=impossible`.
- [ ] Confirm the remaining deployed account permissions match the contract definitions.
- [ ] Copy the Treasury Owner address to CLI, API, web, and Backoffice configuration.
- [ ] Generate the allowlisted public configuration record.
- [ ] Confirm that every intended and observed comparison in the record passes.
- [ ] Keep the record digest with the deployment transaction hashes.

Use `treasury-owner read-state` and `pause-controller read-state` for the state
checks. Query the Mina account for permissions and verification-key hashes.

## Emergency Withdrawal Acceptance

- [ ] Use a test deployment with `proofOrSignature` for this section.
- [ ] Confirm the test Owner has `access=proofOrSignature` and `send=proofOrSignature`.
- [ ] Confirm the Treasury Owner signature can withdraw a small amount on the test deployment.
- [ ] Confirm the emergency command rejects a proof-only test deployment.
- [ ] Confirm another key cannot authorize the withdrawal.
- [ ] Confirm an amount above the available Owner balance fails.
- [ ] Confirm normal proof-authorized Proposal execution remains available.
- [ ] Confirm emergency withdrawal does not change Proposal state.
- [ ] Confirm direct Mina balances have the expected changes.

Do not use production funds to perform this acceptance test.

If the production deployment uses `proof`, record that emergency withdrawal is
not available for its Owner address.

## Data and Services

- [ ] Confirm Postgres is writable and migrations can run.
- [ ] Confirm the SQLite host directory exists and is writable by UID `1000`.
- [ ] Confirm the staking ledger snapshot directory is readable by the scheduler.
- [ ] Confirm Redis is available when proof workers are enabled.
- [ ] Confirm the proving scheduler has `PROOFS_ENABLED=true`.
- [ ] Confirm each proof worker uses the same Redis and queue name.
- [ ] Confirm the API, indexer, processor, scheduler, and worker processes can restart.
- [ ] Confirm local Archive components can restart if this deployment runs them.
- [ ] For Kubernetes, confirm S3 artifact access, Redis persistence, scheduler Services, and proof-worker scaling.
- [ ] For Kubernetes, confirm every environment-specific Helm placeholder was replaced and reviewed.
- [ ] Confirm external alert settings if this deployment supplies alerts.

If this deployment supplies alerts, configure its routes and thresholds as
required.

## First Operational Check

Run these commands after the stack starts:

```bash
curl http://127.0.0.1:4100/healthz
curl http://127.0.0.1:4101/status
curl http://127.0.0.1:4102/status
curl http://127.0.0.1:3200
pnpm testnet:logs
```

Then confirm that the web application uses the expected Treasury Owner
address. A successful `/healthz` response only confirms the HTTP process.

## Sources

- `.nvmrc`
- `package.json`
- `devops/TESTNET.md`
- `devops/TESTNET_MINA_NODE.md`
- `devops/runbooks/1-Network/1a-Archive-Node/README.md`
- `devops/runbooks/1-Network/1b-Mina-Daemon/README.md`
- `devops/runbooks/1-Network/1c-Staking-Ledger-Provider/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/README.md`
- `devops/runbooks/2-Treasury/2d-Lifecycle-Pipeline/README.md`
- `apps/cli/README.md`
- `apps/backoffice/README.md`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts`
