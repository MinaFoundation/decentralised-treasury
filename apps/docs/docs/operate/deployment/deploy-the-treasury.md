---
title: Deploy the Treasury
sidebar_label: Deploy the Treasury
audience: operator
page_kind: procedure
---

# Deploy the Treasury

Use this procedure after
[Configure the Treasury](../lifecycle/configure-the-treasury.md). Configuration
selects the values. This procedure applies them to one release.

This procedure owns compilation, deployment, direct Mina checks, and the
public deployment record. It does not select Treasury policy or generate the
initial environment family.

Read the [CLI prerequisites](../cli/prerequisites.md) before signing. Use the
[CLI command index](../reference/cli-commands.md) to check command options.

For a Kubernetes deployment, use
[2b. Deploy Contracts](../infrastructure/deploy-contracts.md) for the complete
command sequence. Apply the validation and reconciliation controls on this page
to that sequence.

## Before You Start

Obtain the approved configuration baseline. Confirm that it identifies:

- one deployment ID and source revision;
- one target Mina network;
- all policy and circuit values;
- the lifecycle duration and start slot;
- unused Owner and Pause Controller accounts;
- the Owner withdrawal mode;
- five ordered break-glass public keys;
- the environment family and all public endpoints;
- every verification key that the release must rebuild.

Keep the baseline read-only during deployment. Confirm each named private
runtime field is present in its generated environment file.

Use `publicRuntimeValues` as the application checklist. Copy `deploymentId`
and `intended` into `<PUBLIC_INPUT_JSON>`.

Return to configuration when any selected value changes. Do not repair a
configuration difference during deployment.

## Compile One Matched Release

Run the complete compile command once. Keep its structured result:

```bash
LOG_LEVEL=silent dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- treasury-owner compile | tee <COMPILE_RESULT_JSON>
```

The service uses this order:

1. Compile Vote Reducer.
2. Compile Staking Ledger to Voting Ledger.
3. Set both keys and both empty roots on Treasury Proposal.
4. Compile Treasury Proposal.
5. Set its verification key for Treasury Owner proposal creation.
6. Compile Pause Controller and Treasury Owner with the same configuration.

The command emits a `browserEnv` object. Copy all these values:

```text
NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION
NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON
NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON
NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON
NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT
NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT
```

Put them in `<WEB_ENV_FILE>` and `<BACKOFFICE_ENV_FILE>`.
Bootstrap preserves these values on a normal rerun.

These values are compile-time proof configuration. They are not mutable
Treasury Proposal state.

## Validate Predeployment Values

Confirm these values before deployment:

- all duration fields equal the compiled duration;
- the start slot is the selected epoch start;
- all network labels identify the target Mina network;
- all Owner address fields identify the selected Owner account;
- all five proof values are present in web and Backoffice;
- all five participant keys are distinct and in the selected order;
- `ALLOW_DEPLOY_TO_EXISTING_ACCOUNT=false`;
- the withdrawal mode is the selected permanent mode;
- the fee payer has enough balance and the expected nonce;
- the Owner and Pause Controller accounts are unused;
- the signing method can authorize both deployment accounts.

The deploy command compiles the contracts again. It must use the same source
revision, proof mode, lifecycle duration, and compile inputs.

Stop when one check fails. Return to configuration if a selected value must
change.

## Deploy the Contracts

Use five ordered break-glass public keys in the CLI environment. Run the
deployment once and keep its structured result:

```bash
LOG_LEVEL=silent dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- treasury-owner deploy \
  --withdrawal-permission <WITHDRAWAL_PERMISSION> \
  | tee <DEPLOYMENT_RESULT_JSON>
```

The option accepts only `proof` and `proofOrSignature`. Its safe default is
`proof`. You can set `TREASURY_WITHDRAWAL_PERMISSION` instead.

Use `proof` to require a contract proof for Owner withdrawals. This mode keeps
the original contract behavior. Use `proofOrSignature` only when the Owner key
must support emergency withdrawal.

The command deploys Pause Controller first. It then deploys Treasury Owner.
Keep both included transaction hashes.

Do not set `ALLOW_DEPLOY_TO_EXISTING_ACCOUNT=true` for an initial deployment.

Keep control of the Treasury Owner account key after deployment. If you select
`proofOrSignature`, store the key as an offline emergency asset. Prefer the
supported Ledger path. Do not put a production private key in a shared
environment file.

The deployment sets `access` and `send` from the selected withdrawal mode.
`setPermissions` is impossible on the deployed Owner. Thus, the mode cannot
change after deployment. The selection is permanent for the Owner address.

## Read Contract State

Read both contracts:

```bash
dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- treasury-owner read-state

dotenvx run -f <CLI_ENV_FILE> -- \
  pnpm run cli -- pause-controller read-state
```

The Owner result includes `withdrawalPermission`, `accessPermission`, and
`sendPermission`. These values come from the fetched MINA account. Use them as
the on-chain reconciliation result for the selected withdrawal mode. The
permission fields use normalized names such as `proof` and `proofOrSignature`.

Keep both structured state results for the public deployment record.

## Query Mina Accounts

Check the Mina account permissions and verification key:

```bash
PUBLIC_KEY=<CONTRACT_PUBLIC_KEY>

jq -n --arg publicKey "$PUBLIC_KEY" \
  '{query:("query { account(publicKey: \"" + $publicKey + "\") { publicKey token nonce balance { total } permissions { editState access send receive setDelegate setPermissions setVerificationKey { auth txnVersion } setZkappUri editActionState setTokenSymbol incrementNonce setVotingFor setTiming } zkappState verificationKey { hash } } }")}' \
  | curl -fsS -X POST "$MINA_NODE_URL" \
      -H 'content-type: application/json' \
      --data-binary @- \
  | jq .
```

Confirm the exact public key, token, permissions, state, and verification-key
hash. Repeat the query for each deployed contract.

For Treasury Owner, confirm these authorization classes:

| Permission           | `proof` mode                          | `proofOrSignature` mode               |
| -------------------- | ------------------------------------- | ------------------------------------- |
| `editState`          | Proof                                 | Proof                                 |
| `receive`            | Proof                                 | Proof                                 |
| `access`             | Proof                                 | Proof or signature                    |
| `send`               | Proof                                 | Proof or signature                    |
| `incrementNonce`     | Proof or signature                    | Proof or signature                    |
| `setVerificationKey` | Impossible during the current version | Impossible during the current version |
| `setPermissions`     | Impossible                            | Impossible                            |

Confirm that the direct MINA query matches the recorded withdrawal mode. Do not
use emergency withdrawal unless both `access` and `send` permit signatures.

## Generate the Public Configuration Record

Generate one allowlisted JSON record after both Mina account queries. The
record joins the configuration baseline with observed deployment results.

Use `LOG_LEVEL=silent` when you capture each CLI result. This keeps structured
JSON separate from progress logs.

Create one public input JSON object with these sections:

| Input section                                          | Required content                                                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploymentId` and `generatedAt`                       | A unique safe ID and an explicit ISO 8601 UTC time.                                                                                                           |
| `intended.sourceRevision` and `intended.buildIdentity` | The public source and build identities used for this release.                                                                                                 |
| `intended.networkId` and `intended.publicEndpoints`    | The selected network plus Mina, Archive, Treasury API, Indexer API, Processor API, web, and Backoffice HTTP or HTTPS URLs. URLs must not contain credentials. |
| `intended.policyConstants`                             | All acceptance, curve, bond, lifecycle-count, participant-count, and signature-threshold values from the configuration baseline.                              |
| Other `intended` fields                                | Both addresses, duration, start slot, withdrawal mode, and five ordered participant public keys.                                                              |
| `compileResult`                                        | The complete JSON result from `treasury-owner compile`.                                                                                                       |
| `deploymentResult`                                     | The complete JSON result from `treasury-owner deploy`.                                                                                                        |
| `ownerState`                                           | The complete JSON result from `treasury-owner read-state`.                                                                                                    |
| `pauseState`                                           | The complete JSON result from `pause-controller read-state`.                                                                                                  |
| `accountQuery`                                         | The network ID, both addresses, both verification-key hashes, and Owner `access` and `send` permissions from direct Mina queries.                             |

Run the exporter from the repository root:

```bash
pnpm deployment:config -- --input <PUBLIC_INPUT_JSON>
```

The exporter rejects mismatched values, missing proof data, repeated signer
keys, endpoint URLs with credentials, and an existing output file. It uses a
public-field allowlist. It ignores extra secret or signing fields.

The record contains:

- the schema version, deployment ID, source revision, and build identity;
- the network ID and public service endpoints;
- both contract addresses and deployment transaction hashes;
- the lifecycle duration and start slot;
- the withdrawal mode;
- five ordered participant public keys and their commitment;
- all five verification-key hashes;
- the three browser verification keys;
- both empty roots;
- each intended value, observed value, and comparison status;
- a SHA-256 digest of the record.

Store it at:

```text
deployments/<DEPLOYMENT_ID>/public-configuration.json
```

The command prints the output path and digest. Keep the digest with both
deployment transaction hashes.

Do not overwrite an existing record unless you correct that record. The
`--force` option permits replacement. Keep the prior record and explain the
correction.

## Reconcile Intended and Observed Values

“Build-bound” means Mina does not expose the value as a separate state field.
The deployed verification key binds that value.

| Value                             | Intended source                                | Observed source                                                        | Required result                               |
| --------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Network identity                  | selected `MINA_NETWORK_ID` and endpoint record | provider or daemon network identity                                    | Exact target network                          |
| Treasury Owner address            | deployment input                               | deploy result and direct Mina account query                            | Exact match                                   |
| Pause Controller address          | deployment input                               | deploy result, Owner state, and direct Mina account query              | Exact match                                   |
| Lifecycle start slot              | deployment input                               | Owner `treasuryDeployedAtSlot` state                                   | Exact match                                   |
| Withdrawal mode                   | deployment input                               | Owner `access` and `send` permissions                                  | Both permissions match the selected mode      |
| Initial Owner link                | selected Pause Controller address              | Owner `pauseControllerPublicKey` state                                 | Exact match                                   |
| Initial Pause Controller state    | `paused=false`                                 | Pause Controller state                                                 | Exact match                                   |
| Signer commitment                 | commitment from five ordered keys              | Pause Controller `multisigCommitment` state                            | Exact match                                   |
| Owner verification key            | compile result                                 | Owner account verification-key hash                                    | Exact match                                   |
| Pause Controller verification key | compile result                                 | Pause Controller account verification-key hash                         | Exact match                                   |
| Duration                          | selected compile input                         | build-bound by Owner key; also used to calculate current period        | Runtime fields match the deployed Owner build |
| Acceptance and bond constants     | selected source revision                       | build-bound by Proposal and Owner keys                                 | Source revision and expected key hashes match |
| ZkProgram keys and empty roots    | compile result                                 | build-bound by Proposal and Owner keys; distributed to proof consumers | Exact compile set in all consumers            |

Do not state that a build-bound value was read as a separate Mina state field.
Use the verification-key comparison and the reproducible release record.

## Release the Deployment

Release the deployment only after every comparison passes. Confirm that all
runtime components use the public values from this release.

A failed comparison is not a documentation difference. It is a deployment
stop condition.

## Deployment Checklist for a Contract Constant Change

Use this checklist after the configuration change checklist:

- [ ] Use the approved configuration baseline and its source revision.
- [ ] Use the generated environment family from the approved baseline.
- [ ] Compile all contracts and ZkPrograms in dependency order.
- [ ] Record all five verification-key hashes and both empty roots.
- [ ] Copy the complete `browserEnv` result to web and Backoffice.
- [ ] Complete every predeployment check.
- [ ] Deploy new contract accounts.
- [ ] Read both contract states and query both Mina accounts.
- [ ] Compare all intended and observed values.
- [ ] Generate the public deployment record and digest.
- [ ] Run the ideal lifecycle as the release-qualification test.
- [ ] Promote the release only after the lifecycle reconciliation passes.

## Deployment Stop Conditions

Do not deploy when:

- an environment file does not match the configuration baseline;
- the source revision or build identity is unknown;
- a proof value is absent or comes from another compile;
- the deploy command would use different compile inputs;
- a participant key is empty, repeated, or out of order;
- the withdrawal mode is not explicit;
- the fee payer, nonce, or signing method is not ready;
- a target contract account already exists without an explicit recovery reason.

Do not release the deployment when:

- a transaction is not included;
- initial contract state differs from the configuration baseline;
- an account permission or verification-key hash differs;
- any intended and observed Mina value differs;
- a build-bound constant cannot be tied to the expected verification key;
- the public deployment record does not pass its checks.

## Continue to Lifecycle Operation

Deployment ends after the public configuration record passes its checks.
For Kubernetes, continue with
[2c. Deploy Stack](../infrastructure/deploy-stack.md), and then use
[2d. Lifecycle Pipeline](../infrastructure/lifecycle-pipeline.md).

Continue with [Ideal Lifecycle Operation](../lifecycle/ideal-lifecycle.md)
after the required application services are available.

That procedure owns treasury funding, service startup, proving, voting,
tally, execution, and reconciliation. Use
[Service Procedures](../services/service-operations.md) for focused service
commands.

## Sources

- `devops/TESTNET.md`
- `devops/runbooks/2-Treasury/2b-Deploy-Contracts/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/README.md`
- `devops/scripts/export-public-deployment-config.mjs`
- `apps/cli/src/commands/treasury-owner.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `apps/api`
- `apps/backoffice`
- `apps/cli`
- `apps/web`
