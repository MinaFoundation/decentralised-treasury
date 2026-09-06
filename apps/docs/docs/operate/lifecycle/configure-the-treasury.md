---
title: Configure the Treasury
sidebar_label: Configure the Treasury
audience: operator
page_kind: procedure
---

# Configure the Treasury

Use this procedure before deployment. It selects the business rules and
technical inputs. It also generates the environment files for one release.

The result is one configuration baseline:

- one policy selection;
- one source revision;
- one set of circuit and deployment inputs;
- one target Mina network;
- one set of runtime values;
- one list of verification keys that the release must rebuild.

This page does not compile or deploy the contracts. It does not compare a
deployment with Mina account state. The separate
[Deploy the Treasury](../deployment/deploy-the-treasury.md) procedure
performs those actions.

Do not select values independently in different environment files.

## Configuration Classes

The class tells the operator how a value can change.

| Class            | Meaning                                                                                              | How it changes                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Policy constant  | A business or governance rule, such as an acceptance threshold or bond rule.                         | Change source, test the rule, compile new contracts, and make a new release.                                   |
| Circuit constant | A fixed proof shape, relation input, or contract compile input.                                      | Change source or a supported compile input, then rebuild each affected verification key.                       |
| Deployment input | A value that becomes account state, account permissions, a key commitment, or a deployment identity. | Select it before deployment. It is not a normal runtime change.                                                |
| Runtime value    | A value that tells the CLI, services, web application, or proof workers which release to use.        | Distribute the exact release value to each consumer. A runtime value cannot change deployed contract behavior. |

Some business choices are circuit inputs. For example,
`LIFECYCLE_PERIOD_DURATION` is a policy choice that becomes a Treasury Owner
circuit constant. This page classifies it by its change boundary: **circuit
constant**.

## Production Policy Status

:::warning A production decision source is not present

The repository implements the current threshold, curve, duration, and bond
values. It does not contain a ratified decision source that explains why these
values are the production policy.

Do not treat an implemented default as policy approval. Before a production
release, attach a decision record that identifies the selected values, the
reason for them, the approving authority, the effective network, the source
revision, the decision date, and the next review date.

This documentation does not invent a reason that the repository does not
supply.

:::

Track this open policy decision in the project's approved decision record.

The values without a supplied production rationale are:

- `LIFECYCLE_PERIOD_DURATION = 7140`;
- `BOND_AMOUNT_DIVISOR = 10`;
- participation thresholds from `2000` to `5000` basis points;
- approval thresholds from `5100` to `7000` basis points;
- participation curve constant `500`;
- approval curve constant `1000`.

## Policy Constant Catalog

“Affected key” names the verification key that changes directly. An arrow
names a dependent key that must compile against the changed key.

A source-only constant has a current implemented value. It does not have a
runtime default or override.

| Value                             | Current value | Unit                               | Allowed release range                                                                    | Affected key                         |
| --------------------------------- | ------------: | ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| `BASIS_POINTS`                    |       `10000` | basis points, where `10000 = 100%` | Keep at `10000` unless the complete acceptance scale changes.                            | Treasury Proposal → Treasury Owner   |
| `MIN_PARTICIPATION_BP`            |        `2000` | basis points                       | `0..10000`; must be less than or equal to the maximum.                                   | Treasury Proposal → Treasury Owner   |
| `MAX_PARTICIPATION_BP`            |        `5000` | basis points                       | `0..10000`; must be greater than or equal to the minimum.                                | Treasury Proposal → Treasury Owner   |
| `MIN_APPROVAL_BP`                 |        `5100` | basis points                       | `0..10000`; must be less than or equal to the maximum.                                   | Treasury Proposal → Treasury Owner   |
| `MAX_APPROVAL_BP`                 |        `7000` | basis points                       | `0..10000`; must be greater than or equal to the minimum.                                | Treasury Proposal → Treasury Owner   |
| `CURVE_CONSTANT_PARTICIPATION_BP` |         `500` | basis-point curve factor           | Positive `UInt128`. Test all integer denominators. The source has no upper policy bound. | Treasury Proposal → Treasury Owner   |
| `CURVE_CONSTANT_APPROVAL_BP`      |        `1000` | basis-point curve factor           | Positive `UInt128`. Test all integer denominators. The source has no upper policy bound. | Treasury Proposal → Treasury Owner   |
| `BOND_AMOUNT_DIVISOR`             |          `10` | dimensionless divisor              | Positive integer. The source has no upper policy bound.                                  | Treasury Proposal and Treasury Owner |

These are source constants. They have no environment override.

## Circuit Constant Catalog

| Value                                          | Current value or default                          | Unit                             | Allowed value or rule                                                             | Affected key                                                                          |
| ---------------------------------------------- | ------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `LIFECYCLE_PERIOD_DURATION`                    | `7140`                                            | Mina global slots per period     | `1..4294967295`; for supported Mesa operation, use the `7140`-slot Mina epoch.    | Treasury Owner                                                                        |
| `LifecyclePeriod.NUMBER_OF_PERIODS`            | `4`                                               | periods per lifecycle            | Fixed source value. The period codes are `0..3`.                                  | Treasury Owner                                                                        |
| `ACCOUNT_BATCH_SIZE`                           | `5`                                               | staking accounts per proof batch | Positive source integer. The tracer and circuit must use the same value.          | Staking Ledger to Voting Ledger → Treasury Proposal → Treasury Owner                  |
| `VOTE_ACTION_BATCH_SIZE`                       | `5`                                               | vote actions per proof batch     | Positive source integer. The tracer and circuit must use the same value.          | Vote Reducer → Treasury Proposal → Treasury Owner                                     |
| Action-state history target count              | `5`                                               | action-state hashes              | Fixed proof and method shape.                                                     | Vote Reducer, Treasury Proposal, and Treasury Owner                                   |
| Staking ledger witness height                  | `36`                                              | Merkle-tree levels               | Fixed source value for the Mina staking ledger relation.                          | Staking Ledger to Voting Ledger and Treasury Proposal → Treasury Owner                |
| Voting and nullifier witness height            | `255`                                             | Merkle-tree levels               | Fixed source value for the voting and nullifier ledgers.                          | Vote Reducer and Staking Ledger to Voting Ledger → Treasury Proposal → Treasury Owner |
| Vote Reducer `maxProofsVerified`               | `2`                                               | recursive proofs                 | Fixed source value.                                                               | Treasury Proposal → Treasury Owner                                                    |
| Staking proof `maxProofsVerified`              | `2`                                               | recursive proofs                 | Fixed source value.                                                               | Treasury Proposal → Treasury Owner                                                    |
| `MULTISIG_PARTICIPANTS_COUNT`                  | `5`                                               | ordered key positions            | Fixed source array size.                                                          | Pause Controller                                                                      |
| `MIN_VALID_MULTISIG_SIGNATURES_COUNT`          | `3`                                               | valid signature positions        | `1..5`; a source change requires a new Pause Controller release.                  | Pause Controller                                                                      |
| Break-glass message prefixes                   | `MFDT`, `MFDTtpp`, `MFDTpt`, `MFDTupt`, `MFDTrmk` | signature domains                | Fixed non-empty source strings.                                                   | Pause Controller                                                                      |
| `TreasuryProposalSmartContract.permissionType` | `proof`                                           | child update authorization       | Source choices are `proof` or `signature`. There is no CLI or environment option. | Treasury Owner                                                                        |

`TreasuryProposalSmartContract.permissionType` is not the Treasury Owner
withdrawal permission. Do not use one value as a substitute for the other.

:::caution Update duplicate consumers in one release

The web Proposal builder also uses the bond divisor value. Backoffice also
uses the five-position and three-signature values. These consumers do not
import all values from the contract modules.

When one of these constants changes, search for the old literal and update all
consumers before compilation and release.

:::

## Generated Compile Values

The compiler generates these values as one set. They are not independent
policy choices.

| Value                                            | Default | Unit or type          | Allowed value                                                    | Affected key                       |
| ------------------------------------------------ | ------- | --------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| Vote Reducer verification key                    | None    | o1js verification key | Exact output from the selected source revision and compile mode. | Treasury Proposal → Treasury Owner |
| Staking Ledger to Voting Ledger verification key | None    | o1js verification key | Exact output from the same release compile.                      | Treasury Proposal → Treasury Owner |
| Empty voting ledger root                         | None    | Mina `Field`          | Root generated from the configured empty voting tree.            | Treasury Proposal → Treasury Owner |
| Empty nullifier root                             | None    | Mina `Field`          | Root generated from the configured empty nullifier tree.         | Treasury Proposal → Treasury Owner |
| Treasury Proposal verification key               | None    | o1js verification key | Compile after both ZkProgram keys and both roots are set.        | Treasury Owner                     |
| Pause Controller verification key                | None    | o1js verification key | Compile from the same source revision.                           | Pause Controller account           |
| Treasury Owner verification key                  | None    | o1js verification key | Compile last with the selected duration and Proposal key.        | Treasury Owner account             |

The supported compile order is:

1. Vote Reducer.
2. Staking Ledger to Voting Ledger.
3. Treasury Proposal with both ZkProgram keys and both empty roots.
4. Pause Controller.
5. Treasury Owner with the Proposal key and lifecycle duration.

## Deployment Input Catalog

| Input                               | Default                         | Unit or type                                 | Allowed value or rule                                                                                                        | Affected key                                              |
| ----------------------------------- | ------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Source revision                     | None                            | Git commit                                   | One immutable revision for compile, deployment, and services.                                                                | Identifies all keys; does not change one by itself.       |
| `MINA_NETWORK_ID`                   | `devnet`                        | signature network                            | `mainnet`, `devnet`, or `testnet`; it must identify the target endpoint.                                                     | None                                                      |
| `MINA_NODE_URL`                     | `http://127.0.0.1:8080/graphql` | URL                                          | Reachable Mina GraphQL URL for the selected network.                                                                         | None                                                      |
| Treasury Owner identity             | None                            | Mina public key and deployment authorization | One unused account for an initial deployment.                                                                                | None                                                      |
| Pause Controller identity           | None                            | Mina public key and deployment authorization | One unused account for an initial deployment.                                                                                | None                                                      |
| `TREASURY_DEPLOYED_AT_SLOT`         | `0`                             | Mina global slot                             | `0..4294967295`; supported operation uses the first slot of an epoch. A past or future epoch start is valid.                 | None; stored in Owner state.                              |
| `TREASURY_WITHDRAWAL_PERMISSION`    | `proof`                         | account permission mode                      | `proof` or `proofOrSignature`. The value sets both `access` and `send`.                                                      | None; sets permanent account permissions.                 |
| `MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | None                            | ordered public-key list                      | Exactly five valid, distinct, non-empty Mina public keys.                                                                    | None; the commitment is stored in Pause Controller state. |
| `ALLOW_DEPLOY_TO_EXISTING_ACCOUNT`  | `false`                         | Boolean                                      | Keep `false` for an initial release.                                                                                         | None                                                      |
| `TX_FEE`                            | `1000000000`                    | nanomina                                     | `UInt64`; select a sufficient deployment fee.                                                                                | None                                                      |
| `TX_NONCE`                          | Unset                           | fee-payer nonce                              | For deployment, use the current fee-payer nonce or an explicit valid integer. Other commands can use this field differently. | None                                                      |
| `TX_MEMO`                           | Unset                           | text                                         | Optional transaction memo.                                                                                                   | None                                                      |
| `TX_WAIT`                           | `true`                          | Boolean                                      | `true` or `false`; use `true` for the documented reconciliation flow.                                                        | None                                                      |

The withdrawal permission cannot change on the same Treasury Owner address.
The deployed account makes `setPermissions` impossible.
See the CLI reference [nonce rules](../reference/cli-commands.md#nonce-rules)
before you reuse this environment field for a Pause Controller action.

## Runtime Value Catalog

These values select and distribute one deployment. They do not replace the
policy, compile, or deployment steps.

| Runtime value                              | Current default                                       | Unit or type                 | Allowed value or rule                                                                       | Affected key                                                            |
| ------------------------------------------ | ----------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `PROOFS_ENABLED`                           | Backend default `false` when it is not exactly `true` | Boolean text                 | `true` for release compilation and production proof workers.                                | Selects proof artifacts; rebuild the complete key chain as one release. |
| `NEXT_PUBLIC_PROOFS_ENABLED`               | Deployment-dependent                                  | Boolean text                 | `true` or `false` as required by the web deployment. It does not prove backend worker mode. | None by itself.                                                         |
| Owner address fields                       | No safe deployment default                            | Mina public key              | The exact deployed Owner address in CLI, API, indexer, web, and Backoffice.                 | None                                                                    |
| Pause Controller address fields            | None                                                  | Mina public key              | The address stored by the Owner.                                                            | None                                                                    |
| Lifecycle duration fields                  | Source or template dependent                          | Mina slots                   | `1..4294967295`; every consumer must use the compiled duration.                             | A different compiled value requires a new Owner key.                    |
| Lifecycle start-slot fields                | Template default can be `0`                           | Mina global slot             | `0..4294967295`; API and scheduler must use the value stored by the Owner.                  | None                                                                    |
| Browser network ID                         | Application-specific text form                        | network label                | A normalized label for the selected signing network. Do not infer it from a URL.            | None                                                                    |
| Three browser verification-key JSON values | None                                                  | JSON verification keys       | The exact compiler output, copied as one set.                                               | Inputs to browser proof construction.                                   |
| Two browser empty-root values              | None                                                  | decimal Mina `Field` strings | The exact compiler output, copied as part of the same set.                                  | Inputs to Treasury Proposal proof construction.                         |
| Five Backoffice participant public keys    | None                                                  | ordered Mina public keys     | Exactly five keys in the deployment order. The commitment must match Mina state.            | None                                                                    |
| Mina and Archive endpoints                 | Local defaults exist                                  | URLs                         | Each endpoint must serve the selected Mina network and be reachable by its consumer.        | None                                                                    |
| `NEXT_PUBLIC_SLOT_DURATION_MS`             | Deployment-dependent                                  | milliseconds                 | Use `90000` for Mesa. This is a display estimate and does not set a contract period.        | None                                                                    |
| `PROPOSAL_CONTENT_MAX_CHARS`               | `32768`                                               | characters                   | Positive integer. It does not change the on-chain URI byte limit.                           | None                                                                    |

The [Environment Field Index](../reference/environment-fields.md) lists all
service ports, polling intervals, queues, storage paths, and per-operation
fields. Those values operate the deployment. They do not configure the
Treasury acceptance policy.

## Acceptance Examples

These examples use normalized accounting units:

```text
snapshot Treasury Owner balance = 10000
snapshot staking-ledger total currency = 10000
```

They do not claim a real treasury balance. Every division uses integer
division in the same order as the contract.

| Request class                              | Requested amount |   Bond | Execution cap |                       Required participation |       Required approval |
| ------------------------------------------ | ---------------: | -----: | ------------: | -------------------------------------------: | ----------------------: |
| Small, `1%` of snapshot balance            |            `100` |   `10` |         `110` | `2504` weight, or `25.04%` of total currency | `52.74%` of `yay + nay` |
| Medium, `25%` of snapshot balance          |           `2500` |  `250` |        `2750` | `4608` weight, or `46.08%` of total currency | `65.61%` of `yay + nay` |
| Treasury-sized, `100%` of snapshot balance |          `10000` | `1000` |       `11000` | `5000` weight, or `50.00%` of total currency | `70.00%` of `yay + nay` |

The bond is `floor(requestedAmount / 10)`. The Proposal execution cap is the
requested amount plus this bond. The cap does not reserve funds. Execution is
also limited by the current Treasury Owner balance.

At the exact acceptance boundary, these vote sets pass:

| Request class  | Participation boundary with full approval | Approval boundary with full participation |
| -------------- | ----------------------------------------- | ----------------------------------------- |
| Small          | `yay=2504, nay=0, abstain=0`              | `yay=5274, nay=4726, abstain=0`           |
| Medium         | `yay=4608, nay=0, abstain=0`              | `yay=6561, nay=3439, abstain=0`           |
| Treasury-sized | `yay=5000, nay=0, abstain=0`              | `yay=7000, nay=3000, abstain=0`           |

`abstain` counts for participation. It does not count in the approval
denominator. See [Constants and Acceptance Math](../reference/constants-and-acceptance.md)
for the exact equation and integer division order.

## Select the Treasury Configuration

Configuration selects values. Deployment applies those values to a release.
Do not run a deployment command from this page.

### 1. Identify the Release

Select a deployment ID, source revision, target network, and operator
record directory. Do not reuse an ID for another contract pair.

Record the policy decision source. If it is not available, mark the policy
status as unresolved. Do not describe implemented defaults as ratified values.

### 2. Select Policy Constants

Select each value in the Policy Constant Catalog. Record the value, reason,
decision source, effective network, and source revision.

Use the worked examples to review the result. Use
[Constants and Acceptance Math](../reference/constants-and-acceptance.md) to
calculate other request sizes.

### 3. Select the Lifecycle and Capacity

Set `LIFECYCLE_PERIOD_DURATION` to the Mina epoch length in slots. Select
`TREASURY_DEPLOYED_AT_SLOT` as the first slot of an epoch.

For Mesa, `7140` slots are `178.5` hours, or `7.4375` days. Use
[Voting Capacity and Period Sizing](voting-capacity-and-period-sizing.md) to
check that delegate transactions and proof work fit this period.

The start slot can be in the future. It can be in the past when the required
historical staking snapshots are available. Do not select `0` only because a
template uses that value.

Use [Lifecycle Configuration](configuration.md) to calculate all period and
snapshot boundaries.

### 4. Select Permissions and Identity Generation

Select the Owner withdrawal mode. Select how bootstrap handles Mina
identities.

Use `proof` unless the release needs the separate Owner-signature emergency
withdrawal layer. The mode is permanent for the Owner account.

For a new family, bootstrap creates the Owner, Pause Controller, and five
break-glass keys. `--fresh-keys` replaces these identities. A normal rerun
retains them.

The current bootstrap command cannot import arbitrary Owner, Pause Controller,
or participant keys. Use an existing generated family when those exact keys
must remain.

### 5. Select Runtime Values

Select the environment family, public endpoints, proof mode, storage paths,
service addresses, transaction defaults, and polling values.

Use one target network for the complete family. Do not mix host, container,
and browser URL forms.

The [Environment Field Index](../reference/environment-fields.md) gives every
field. Step 6 generates and updates the package-specific files.

### 6. Generate and Apply the Environment

Generate the package-specific environment files before you approve the
baseline. The generated public keys become the selected deployment identities.

:::note Infrastructure procedures are available

Use the [infrastructure runbooks](../infrastructure/index.md) for the Kubernetes
network and application stack. Those procedures supply deployment commands and
Helm values. This page remains the source for Treasury policy and configuration
decisions.

:::

#### Prepare External Services

Provide these endpoints before bootstrap:

- a host-reachable Mina GraphQL endpoint;
- a host-reachable Archive GraphQL endpoint;
- container-reachable forms of both endpoints;
- a browser-reachable Mina GraphQL endpoint.

One operator can use endpoints from a service provider. The operator can also
deploy the services with
[1a. Archive Node](../infrastructure/archive-node.md) and
[1b. Mina Daemon](../infrastructure/mina-daemon.md).

Use [1c. Staking Ledger Provider](../infrastructure/staking-ledger-provider.md)
when the Kubernetes voting-ledger scheduler must receive snapshots by HTTP.

#### Generate an Environment Family

`{ENVIRONMENT}` is a placeholder in this documentation. Replace it with the
selected environment family before you run a command. The generator currently
accepts `testnet` and `local-blockchain`. Use `local-blockchain` only with the
simulator.

The bootstrap command renders the checked-in templates for one family:

Run it from the repository root.

```bash
pnpm env:bootstrap {ENVIRONMENT} -- \
  --mina-node-url <HOST_MINA_GRAPHQL_URL> \
  --archive-node-url <HOST_ARCHIVE_GRAPHQL_URL> \
  --compose-mina-node-upstream <CONTAINER_MINA_UPSTREAM> \
  --compose-archive-node-url <CONTAINER_ARCHIVE_GRAPHQL_URL> \
  --next-public-treasury-api-url <BROWSER_TREASURY_API_URL> \
  --next-public-indexer-api-url <BROWSER_INDEXER_API_URL> \
  --next-public-processor-api-url <BROWSER_PROCESSOR_API_URL> \
  --next-public-mina-node-url <BROWSER_MINA_GRAPHQL_URL>
```

For each endpoint, the command uses this order:

1. Bootstrap command option.
2. Matching field in the current process environment.
3. Built-in default for the selected family.

| Bootstrap option                        | Process environment fallback                               | Effect                                                               |
| --------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `--sender-private-key <key>`            | None                                                       | Selects the CLI sender key.                                          |
| `--mina-node-url <url>`                 | `MINA_NODE_URL`                                            | Sets the host CLI Mina GraphQL URL.                                  |
| `--archive-node-url <url>`              | `ARCHIVE_NODE_URL`                                         | Sets the host Archive GraphQL URL.                                   |
| `--compose-mina-node-upstream <url>`    | `MINA_NODE_PROXY_UPSTREAM`                                 | Sets the container-reachable Mina upstream.                          |
| `--compose-archive-node-url <url>`      | `COMPOSE_ARCHIVE_NODE_URL`                                 | Sets the container-reachable Archive URL.                            |
| `--next-public-treasury-api-url <url>`  | `NEXT_PUBLIC_TREASURY_API_URL`, then `NEXT_PUBLIC_API_URL` | Sets the browser Treasury API URL.                                   |
| `--next-public-indexer-api-url <url>`   | `NEXT_PUBLIC_INDEXER_API_URL`                              | Sets the browser Indexer API URL.                                    |
| `--next-public-processor-api-url <url>` | `NEXT_PUBLIC_PROCESSOR_API_URL`                            | Sets the browser Processor API URL.                                  |
| `--next-public-mina-node-url <url>`     | `NEXT_PUBLIC_MINA_NODE_URL`                                | Sets the browser Mina GraphQL URL.                                   |
| `--fresh-keys`                          | None                                                       | Generates new Mina identities, except an explicitly supplied sender. |
| `--overwrite-secrets`                   | None                                                       | Generates a new Postgres password and rebuilds `DATABASE_URL`.       |

The generator rejects an unknown family, an unknown option, a missing option
value, and an invalid Mina private key. It does not confirm that URLs identify
the same Mina network. Check the generated values before you approve the baseline.

##### Generated Files

The command replaces these ignored runtime files:

| Placeholder                   | Consumer                   | Generated path pattern                         |
| ----------------------------- | -------------------------- | ---------------------------------------------- |
| `<DEVOPS_ENV_FILE>`           | Compose and infrastructure | `devops/.env.{ENVIRONMENT}`                    |
| `<API_ENV_FILE>`              | App API and processor      | `apps/api/.env.{ENVIRONMENT}`                  |
| `<BACKOFFICE_ENV_FILE>`       | Backoffice                 | `apps/backoffice/.env.{ENVIRONMENT}`           |
| `<CLI_ENV_FILE>`              | CLI                        | `apps/cli/.env.{ENVIRONMENT}`                  |
| `<WEB_ENV_FILE>`              | Web application            | `apps/web/.env.{ENVIRONMENT}`                  |
| `<LOCAL_BLOCKCHAIN_ENV_FILE>` | Local simulator            | `packages/local-blockchain/.env.{ENVIRONMENT}` |

The generator creates `<LOCAL_BLOCKCHAIN_ENV_FILE>` only for the
`local-blockchain` family. Each output comes from the adjacent
`.env.{ENVIRONMENT}.example` template.

The rest of this book uses the placeholders in this table. Replace each
placeholder with the generated file for that consumer. Do not use the CLI file
as a Compose input. It can contain private keys.

New output files request owner-only file mode `0600`. An overwrite does not
repair the permissions of an existing file. Confirm the file permissions.

##### Generated and Retained Values

The generator creates or retains these Mina identities:

- the CLI sender;
- the Treasury Owner;
- the Pause Controller;
- five ordered break-glass participants;
- five local simulator voters.

The public keys are derived from the selected private keys. The Owner public
key is copied to its API, Backoffice, and web fields. The ordered break-glass
public keys are copied to Backoffice. Private keys stay in the CLI runtime
file. The testnet templates do not write the generated simulator voter keys.

| Run mode              | Mina identities                                                                      | Database password                                   | Browser proof fields                                  | Other values                                    |
| --------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Normal rerun          | Keep existing CLI private keys and derive their public keys again.                   | Keep the existing value.                            | Keep the three verification keys and two empty roots. | Render again from templates and current inputs. |
| `--fresh-keys`        | Generate new sender, Owner, Pause Controller, participant, and simulator voter keys. | Keep the existing value.                            | Keep the five proof fields.                           | Render again from templates and current inputs. |
| `--overwrite-secrets` | Keep the existing Mina keys.                                                         | Generate a new password and rebuild `DATABASE_URL`. | Keep the five proof fields.                           | Render again from templates and current inputs. |

An explicit `--sender-private-key <FUNDED_SENDER_PRIVATE_KEY>` takes priority
over retained or newly generated sender keys. This option can put the private
key in shell history and process arguments. Use it only for a local or test
account.

Bootstrap rewrites the complete file. It is not a merge operation. Manual
values that the generator does not preserve are replaced by template values.
For example, it does not preserve `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION`.
Review and apply the selected duration again after each bootstrap.

Bootstrap does not compile circuits. On the first run, the three browser
verification-key fields and two empty-root fields are blank. The deployment procedure fills them after `treasury-owner compile`. A normal
later bootstrap keeps these five fields.

Review all proof-mode fields before you start services. The API and CLI
templates set `PROOFS_ENABLED=true`. The web template sets
`NEXT_PUBLIC_PROOFS_ENABLED=true`. The Compose proof services need their own
resolved `PROOFS_ENABLED=true` value.

The generator writes files one at a time. If it fails, some files can contain
new values while other files contain old values. Do not use that family. Fix
the error, run bootstrap again, and check every generated file.

On success, the generator prints the written paths and the public Sender,
Treasury Owner, and Pause Controller addresses. It does not print private keys.

Record the generated or retained Owner and Pause Controller public keys. Record
the five participant public keys from `<BACKOFFICE_ENV_FILE>` in their exact
order. These values become the selected deployment identities.

Assign one public-key position to each break-glass signer. Use the custody and
verification rules in [Break-Glass Operation](../break-glass/index.md).

Do not run `--fresh-keys` after baseline approval. A new key set requires a new
baseline.

:::danger Generated files contain secrets

Do not commit, publish, log, screenshot, or paste a generated runtime file.
Repository ignore rules do not protect a copied secret.

:::

#### Apply the Selected Runtime Values

Apply every selected runtime field before baseline approval. Use the
[Environment Field Index](../reference/environment-fields.md) for exact field
names and defaults.

| Runtime group                     | Apply to                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Mina network and CLI transactions | `<CLI_ENV_FILE>`                                                                  |
| Treasury and lifecycle values     | `<CLI_ENV_FILE>`, `<API_ENV_FILE>`, `<WEB_ENV_FILE>`, and `<BACKOFFICE_ENV_FILE>` |
| API, Indexer, and Processor       | `<API_ENV_FILE>` and `<DEVOPS_ENV_FILE>`                                          |
| Browser endpoints and network     | `<WEB_ENV_FILE>` and `<BACKOFFICE_ENV_FILE>`                                      |
| Queue, storage, and polling       | `<DEVOPS_ENV_FILE>` and the applicable application file                           |
| Local simulator values            | `<LOCAL_BLOCKCHAIN_ENV_FILE>` only                                                |

Record the destination file and field for each selected runtime value. Add all
public values to the baseline. Do not continue when one field has no destination.

Bootstrap can replace manual values. Apply and validate the selected values
after each bootstrap run.

#### Validate the Generated Family

| Group            | Values that must agree                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| Treasury address | `TREASURY_OWNER_PUBLIC_KEY`, API contract address, web contract address |
| Period duration  | compile, deploy, CLI, API, scheduler, web, backoffice                   |
| Start slot       | deploy `TREASURY_DEPLOYED_AT_SLOT`, API, scheduler                      |
| Withdrawal mode  | deploy option, `TREASURY_WITHDRAWAL_PERMISSION`, configuration baseline |
| Network          | `MINA_NETWORK_ID`, browser network ID, target Mina endpoint             |
| Endpoints        | host, container, and browser forms for each consumer                    |

Set `TREASURY_DEPLOYED_AT_SLOT` in the CLI environment before deployment. Set
the same value in the API environment for the scheduler.

### 7. Review Verification-Key Impact

Use the Affected key column in each catalog. Record every direct and dependent
key that the release must rebuild.

One constant change can affect several keys. Runtime configuration cannot
change a circuit constant or a deployed account permission.

### 8. Approve the Configuration Baseline

Create one configuration baseline with these public fields:

| Section                | Required content                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Identity               | Deployment ID, source revision, target network, and intended build identity.                      |
| Policy decision        | Decision source, selected policy constants, reason, effective network, and review date.           |
| Circuit inputs         | Lifecycle duration, proof-shape constants, and the required verification-key rebuild list.        |
| Deployment inputs      | Owner and Pause Controller identities, start slot, withdrawal mode, and five ordered signer keys. |
| Runtime inputs         | Public runtime values and the field names for private runtime values.                             |
| Expected initial state | Owner link, `paused=false`, selected permissions, and the signer commitment.                      |

Save the baseline at:

```text
deployments/<DEPLOYMENT_ID>/configuration-baseline.json
```

Use this JSON shape. Replace every angle-bracket placeholder.

```json
{
  "deploymentId": "<DEPLOYMENT_ID>",
  "configuredAt": "<ISO_8601_UTC_TIME>",
  "intended": {
    "sourceRevision": "<GIT_COMMIT>",
    "buildIdentity": "<BUILD_IDENTITY>",
    "networkId": "<mainnet|devnet|testnet>",
    "treasuryOwnerAddress": "<OWNER_PUBLIC_KEY>",
    "pauseControllerAddress": "<PAUSE_CONTROLLER_PUBLIC_KEY>",
    "lifecyclePeriodDuration": "<SLOTS>",
    "treasuryDeployedAtSlot": "<GLOBAL_SLOT>",
    "withdrawalPermission": "<proof|proofOrSignature>",
    "multisigParticipantsPublicKeys": [
      "<SIGNER_1_PUBLIC_KEY>",
      "<SIGNER_2_PUBLIC_KEY>",
      "<SIGNER_3_PUBLIC_KEY>",
      "<SIGNER_4_PUBLIC_KEY>",
      "<SIGNER_5_PUBLIC_KEY>"
    ],
    "policyConstants": {
      "basisPoints": "10000",
      "bondAmountDivisor": "10",
      "curveConstantApprovalBp": "1000",
      "curveConstantParticipationBp": "500",
      "maxApprovalBp": "7000",
      "maxParticipationBp": "5000",
      "minApprovalBp": "5100",
      "minParticipationBp": "2000",
      "minValidMultisigSignaturesCount": "3",
      "multisigParticipantsCount": "5",
      "numberOfLifecyclePeriods": "4"
    },
    "publicEndpoints": {
      "archiveNode": "<ARCHIVE_URL>",
      "backoffice": "<BACKOFFICE_URL>",
      "indexerApi": "<INDEXER_API_URL>",
      "minaNode": "<MINA_GRAPHQL_URL>",
      "processorApi": "<PROCESSOR_API_URL>",
      "treasuryApi": "<TREASURY_API_URL>",
      "web": "<WEB_URL>"
    }
  },
  "publicRuntimeValues": {
    "<EXACT_ENVIRONMENT_FIELD>": "<SELECTED_VALUE>"
  },
  "privateRuntimeFieldNames": ["<PRIVATE_ENVIRONMENT_FIELD_NAME>"],
  "verificationKeysToRebuild": ["<AFFECTED_KEY>"]
}
```

Add one `publicRuntimeValues` entry for each public field. Remove the example
entry. Add every direct and dependent key to `verificationKeysToRebuild`.

Do not invent a generated compile value. The deployment procedure creates the
verification keys and empty roots. The public deployment record stores their
final values.

For a private field, record only its field name in
`privateRuntimeFieldNames`. Never record its value in this baseline.

The deployment procedure copies `deploymentId` and `intended` into
`<PUBLIC_INPUT_JSON>`. It adds `generatedAt` and the observed deployment
results after deployment.

Record every public runtime field as a field name and selected value. For a
private field, record its name and confirm its value only in the ignored file.

Do not include a private key, password, signature, recovery value, transaction
nonce, Ledger account index, `DATABASE_URL`, or other credential-bearing URL.

The baseline is the input to deployment. The public deployment configuration
record is a different artifact. Deployment creates that record after it reads
the deployed accounts from the Mina network.

## Configuration Change Checklist

Use this checklist for a policy or circuit constant change.

- [ ] Record the old value, new value, reason, effective network, and decision.
- [ ] Identify every direct and dependent verification key.
- [ ] Search for duplicate literals in applications, tracers, tests, and
      environment templates.
- [ ] Change the source constant and all duplicate consumers in one revision.
- [ ] Add boundary tests for the old and new behavior.
- [ ] Test zero, minimum, maximum, and integer-rounding boundaries.
- [ ] Recalculate all worked examples affected by the change.
- [ ] Update the constant reference and the policy decision source.
- [ ] Create a new configuration baseline. Do not modify a released baseline.
- [ ] Continue with a new deployment. Do not expect a runtime field to change
      an existing circuit or permanent account permission.

## Configuration Stop Conditions

Do not approve the baseline when:

- the production policy status is unclear;
- the source revision or target network is unknown;
- the duration or start slot is not selected;
- the start slot is not an epoch start for supported operation;
- a selected endpoint identifies another Mina network;
- a participant key is empty or repeated;
- the withdrawal mode is not explicit;
- an affected verification key is missing from the rebuild list;
- a selected value has no recorded source or reason.

## Next Step

Continue with [Deploy the Treasury](../deployment/deploy-the-treasury.md).
That procedure compiles the release, deploys both contracts, and reconciles
the result.

## Detailed References

- [Lifecycle Configuration](configuration.md) explains slot and epoch math.
- [Voting Capacity and Period Sizing](voting-capacity-and-period-sizing.md)
  explains transaction and proof capacity.
- [Environment Field Index](../reference/environment-fields.md) defines
  runtime fields.
- [CLI Command Index](../reference/cli-commands.md) defines command inputs and
  authorization.
- [Infrastructure Runbooks](../infrastructure/index.md) supplies the ordered
  Kubernetes procedures and their complete Helm values.

## Sources

- `packages/sdk/src/provable/contracts/treasury-constants.ts`
- `packages/sdk/src/provable/contracts/treasury-owner.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts`
- `packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts`
- `packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts`
- `packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts`
- `packages/sdk/src/provable/merkle-tree/prefixed-merkle-tree.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `apps/cli/src/commands/mina-instance.ts`
- `apps/web/features/proposals/lib/proposal-prover-runtime.ts`
- `apps/backoffice/features/operations.ts`
- `devops/scripts/bootstrap-env.mjs`
- `devops/runbooks/1-Network/1a-Archive-Node/README.md`
- `devops/runbooks/1-Network/1b-Mina-Daemon/README.md`
- `devops/runbooks/1-Network/1c-Staking-Ledger-Provider/README.md`
- `devops/runbooks/2-Treasury/2a-Generate-Treasury-Wallet/README.md`
- `devops/runbooks/2-Treasury/2b-Deploy-Contracts/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/README.md`
- `devops/scripts/export-public-deployment-config.mjs`
- `devops/test/export-public-deployment-config.test.mjs`
- `packages/sdk/test/provable/contracts/treasury-proposal/treasury-proposal.test.ts`
