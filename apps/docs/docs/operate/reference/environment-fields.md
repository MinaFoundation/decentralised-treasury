---
title: Environment Field Index
sidebar_label: Environment fields
sidebar_position: 13
audience: operator
page_kind: reference
---

# Environment field index

Use [Configure the Treasury](../lifecycle/configure-the-treasury.md) to select
values and generate the environment files. Use
[Deploy the Treasury](../deployment/deploy-the-treasury.md) to compile and
deploy them. This page is the field reference for both procedures.

Use one environment family for one target network. Do not mix files from
different families. Generate the files from the repository root:

```bash
pnpm env:bootstrap {ENVIRONMENT}
```

The generator accepts `testnet` and `local-blockchain`. In this book,
`{ENVIRONMENT}` is the selected family. Commands use `<CLI_ENV_FILE>`,
`<DEVOPS_ENV_FILE>`, `<API_ENV_FILE>`, `<BACKOFFICE_ENV_FILE>`, and
`<WEB_ENV_FILE>` for the generated package-specific files. The simulator also
uses `<LOCAL_BLOCKCHAIN_ENV_FILE>`.

Read [Generate an Environment Family](../lifecycle/configure-the-treasury.md#generate-an-environment-family)
before you create or refresh them. That section explains the generated files,
input precedence, retained values, key rotation flags, and full-file overwrite
behavior.

For the Kubernetes value flow, use
[2b. Deploy Contracts](../infrastructure/deploy-contracts.md) to generate and
copy compile values. Then use
[2c. Deploy Stack](../infrastructure/deploy-stack.md) to apply the application
environment and full Helm configuration.

## Required consistency groups

| Value                     | Fields and consumers that must agree                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Treasury Owner address    | `TREASURY_OWNER_PUBLIC_KEY`, `TREASURY_OWNER_CONTRACT_ADDRESS`, `NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS`                                               |
| Withdrawal permission     | `TREASURY_WITHDRAWAL_PERMISSION`, Owner deployment command, and public configuration record                                                                 |
| Lifecycle period duration | `LIFECYCLE_PERIOD_DURATION`, `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION`, Owner compile input, deployment command, CLI transaction builders, scheduler, and web |
| Lifecycle start slot      | `TREASURY_DEPLOYED_AT_SLOT`, Owner deployment state, voting-ledger scheduler, and the public configuration record                                           |
| Transaction network       | `MINA_NETWORK_ID` and `NEXT_PUBLIC_NETWORK_ID`                                                                                                              |
| Vote Reducer key          | `NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON` in web and backoffice                                                                                      |
| Staking proof key         | `NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON` in web and backoffice                                                                   |
| Proposal key              | `NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON` in web and backoffice                                                                                 |
| Empty roots               | `NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT` and `NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT`                                                                               |

The API environment template also carries lifecycle fields. Current `loadApiConfig` does not use them for API routing or projection.

After `treasury-owner compile`, copy the complete `browserEnv` object. It includes `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION` and all five proof values.

## Public Configuration Record

Each deployment gets one generated public configuration record. The exporter
uses only named public fields. It does not copy a complete environment file.

Included fields are the source and build identities, policy constants, public
endpoints, addresses, lifecycle values, withdrawal mode, ordered participant
public keys, transaction hashes, verification-key hashes, proof configuration,
and intended-versus-observed comparisons.

Excluded fields include private keys, passwords, database URLs, signatures,
Ledger account indexes, and transaction nonces.

Run the exporter only after the direct Mina account queries:

```bash
pnpm deployment:config -- --input <PUBLIC_INPUT_JSON>
```

See [Deploy the Treasury](../deployment/deploy-the-treasury.md#generate-the-public-configuration-record)
for the required input sections and reconciliation order.

## Endpoint forms

| Context           | Example form                                                    |
| ----------------- | --------------------------------------------------------------- |
| Host CLI          | `http://127.0.0.1:3001/graphql`                                 |
| Container service | `http://host.docker.internal:3001` or a Compose service name    |
| Browser           | Same-origin proxy, such as `http://127.0.0.1:3100/mina/graphql` |

Do not give a browser a container-only hostname. Do not give a container a host loopback URL for another host process.

## CLI transaction and signing fields

| Field                              | CLI default or omitted behavior   | Purpose                                                                                   |
| ---------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| `MINA_NODE_URL`                    | `http://127.0.0.1:8080/graphql`   | Mina GraphQL endpoint for on-chain reads and Mina transactions.                           |
| `ARCHIVE_NODE_URL`                 | None                              | Required Archive GraphQL endpoint for `proposal fetch-actions` only.                      |
| `TREASURY_API_URL`                 | `http://127.0.0.1:4100`           | App API base URL for `proposal create` content submission only.                           |
| `MINA_NETWORK_ID`                  | `devnet`                          | Network ID for every signed Mina transaction.                                             |
| `SIGNER`                           | `in-memory`                       | `in-memory` or `ledger`.                                                                  |
| `TX_FEE`                           | `1000000000` nanomina             | Fee in nanomina.                                                                          |
| `TX_NONCE`                         | Current fee-payer nonce from Mina | Fee-payer nonce. Four Pause Controller submit commands also use it as their action nonce. |
| `TX_MEMO`                          | None                              | Optional memo.                                                                            |
| `TX_WAIT`                          | `true`                            | Wait for transaction inclusion.                                                           |
| `ALLOW_DEPLOY_TO_EXISTING_ACCOUNT` | `false`                           | Disables the new-account deployment precondition when true.                               |
| `LIFECYCLE_PERIOD_DURATION`        | `7140` slots                      | Contract compile period duration.                                                         |
| `TREASURY_DEPLOYED_AT_SLOT`        | `0`                               | Owner lifecycle start slot.                                                               |
| `TREASURY_WITHDRAWAL_PERMISSION`   | `proof`                           | Owner withdrawal mode: `proof` or `proofOrSignature`.                                     |

The CLI does not derive `MINA_NETWORK_ID` from `MINA_NODE_URL`.
The network ID applies to `in-memory` and `ledger` transactions.

For each option, the CLI uses the command option before its environment field.
If neither value exists, the CLI uses the built-in default when one exists.

For `pause-controller pause-treasury`, `unpause-treasury`,
`toggle-pause-proposal`, and `rotate-multisig-keys`, a supplied `TX_NONCE` is
both the fee-payer nonce and the Pause Controller action nonce. Omit it unless
the two current nonces are equal. `pause-controller deploy` uses `TX_NONCE`
only as the fee-payer nonce. See [Nonce rules](./cli-commands.md#nonce-rules).

Transaction commands use these exact signing fields:

| Signing role     | In-memory private key          | Expected Ledger public key    | Ledger account index                    |
| ---------------- | ------------------------------ | ----------------------------- | --------------------------------------- |
| Sender           | `SENDER_PRIVATE_KEY`           | `SENDER_PUBLIC_KEY`           | `SENDER_LEDGER_ACCOUNT_INDEX`           |
| Funding account  | `FUNDING_PRIVATE_KEY`          | `FUNDING_PUBLIC_KEY`          | `FUNDING_LEDGER_ACCOUNT_INDEX`          |
| Treasury Owner   | `TREASURY_OWNER_PRIVATE_KEY`   | `TREASURY_OWNER_PUBLIC_KEY`   | `TREASURY_OWNER_LEDGER_ACCOUNT_INDEX`   |
| Pause Controller | `PAUSE_CONTROLLER_PRIVATE_KEY` | `PAUSE_CONTROLLER_PUBLIC_KEY` | `PAUSE_CONTROLLER_LEDGER_ACCOUNT_INDEX` |
| Voter            | `VOTER_PRIVATE_KEY`            | `VOTER_PUBLIC_KEY`            | `VOTER_LEDGER_ACCOUNT_INDEX`            |

Each command exposes only the fields for its signing roles. Proposal creation
accepts optional `PROPOSAL_PRIVATE_KEY`. If it is absent, the CLI generates a
keypair in memory and discards the private key after deployment. The CLI does
not expose a Proposal Ledger public-key or account-index field. The private key
cannot authorize later Proposal control. Proposal state uses proof
authorization, and its custom-token account updates require Treasury Owner
approval.

The `multisig-sign` commands use different Ledger field names.
Use `LEDGER_SIGNER_PUBLIC_KEY` and `LEDGER_ACCOUNT_INDEX` for these commands.
Their `TX_NONCE` value is the Pause Controller state nonce.
It is not a Mina fee-payer nonce.

## Contract and Proposal fields

| Field                          | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `TREASURY_OWNER_PUBLIC_KEY`    | Owner account used by CLI commands.                             |
| `TREASURY_OWNER_PRIVATE_KEY`   | Software deployment and emergency-withdrawal key for the Owner. |
| `PAUSE_CONTROLLER_PUBLIC_KEY`  | Pause Controller account.                                       |
| `PAUSE_CONTROLLER_PRIVATE_KEY` | Software deployment key for the Pause Controller.               |
| `PROPOSAL_PUBLIC_KEY`          | Existing Proposal account.                                      |
| `PROPOSAL_PRIVATE_KEY`         | Optional deployment-only Proposal key. Generated if absent.     |
| `PROPOSAL_LIFECYCLE_ID`        | Lifecycle ID for creation.                                      |
| `PROPOSAL_AMOUNT`              | Requested amount in nanomina.                                   |
| `PROPOSAL_CONTENT_FILE`        | Markdown file for creation.                                     |
| `RECIPIENT_PUBLIC_KEY`         | Proposal or emergency-withdrawal recipient.                     |
| `VOTER_PRIVATE_KEY`            | Software voter key.                                             |
| `PROPOSAL_VOTE`                | `yay`, `nay`, or `abstain`.                                     |
| `EXECUTE_PROPOSAL_AMOUNT`      | Optional partial execution amount.                              |
| `TRANSFER_AMOUNT`              | Funding or utility transfer amount.                             |
| `WITHDRAWAL_AMOUNT`            | Emergency withdrawal amount in nanomina.                        |

## Break-glass fields

| Field                                       | Purpose                                   |
| ------------------------------------------- | ----------------------------------------- |
| `MULTISIG_PARTICIPANTS_PUBLIC_KEYS`         | Five ordered current public keys.         |
| `MULTISIG_SIGNATURES`                       | Three to five aligned signature slots.    |
| `CURRENT_MULTISIG_PARTICIPANTS_PUBLIC_KEYS` | Current ordered keys for rotation.        |
| `NEW_MULTISIG_PARTICIPANTS_PUBLIC_KEYS`     | Replacement ordered keys.                 |
| `MULTISIG_SIGNER_PRIVATE_KEY`               | One software signing key.                 |
| `LEDGER_SIGNER_PUBLIC_KEY`                  | One Ledger signer public key.             |
| `LEDGER_ACCOUNT_INDEX`                      | Ledger account index for offline signing. |

Emergency withdrawal uses the normal transaction roles. `TREASURY_OWNER_PUBLIC_KEY` and `TREASURY_OWNER_LEDGER_ACCOUNT_INDEX` select the Owner Ledger account. `SENDER_PUBLIC_KEY` and `SENDER_LEDGER_ACCOUNT_INDEX` select the fee payer.

`TREASURY_WITHDRAWAL_PERMISSION` defaults to `proof`. The
`proofOrSignature` value enables emergency Owner-signature withdrawal. The
deployment choice is permanent for the Owner address.

:::danger Do not put a production emergency key in a shared file

Prefer the supported Ledger path for the Treasury Owner emergency signature. Do not copy a production `TREASURY_OWNER_PRIVATE_KEY` to browser, API, Compose, or shared operator environment files.

:::

The bootstrap can create these five participant pairs:

- `MULTISIG_PARTICIPANT_1_PRIVATE_KEY`, `MULTISIG_PARTICIPANT_1_PUBLIC_KEY`
- `MULTISIG_PARTICIPANT_2_PRIVATE_KEY`, `MULTISIG_PARTICIPANT_2_PUBLIC_KEY`
- `MULTISIG_PARTICIPANT_3_PRIVATE_KEY`, `MULTISIG_PARTICIPANT_3_PUBLIC_KEY`
- `MULTISIG_PARTICIPANT_4_PRIVATE_KEY`, `MULTISIG_PARTICIPANT_4_PUBLIC_KEY`
- `MULTISIG_PARTICIPANT_5_PRIVATE_KEY`, `MULTISIG_PARTICIPANT_5_PUBLIC_KEY`

The local bootstrap also defines these voter pairs:

- `VOTER1_PRIVATE_KEY`, `VOTER1_PUBLIC_KEY`
- `VOTER2_PRIVATE_KEY`, `VOTER2_PUBLIC_KEY`
- `VOTER3_PRIVATE_KEY`, `VOTER3_PUBLIC_KEY`
- `VOTER4_PRIVATE_KEY`, `VOTER4_PUBLIC_KEY`
- `VOTER5_PRIVATE_KEY`, `VOTER5_PUBLIC_KEY`

Keep private values out of browser and API environments.

## Proof and ledger fields

| Field                                        | Purpose                                                     |
| -------------------------------------------- | ----------------------------------------------------------- |
| `PROOFS_ENABLED`                             | Enables proof generation in supported SDK and worker flows. |
| `SQLITE_DATA_DIRECTORY`                      | Lifecycle-specific SQLite data root.                        |
| `SQLITE_DATA_HOST_PATH`                      | Host path mounted at `SQLITE_DATA_DIRECTORY`.               |
| `LIFECYCLE_ID`                               | Local ledger, trace, or proof namespace.                    |
| `STAKING_LEDGER_PATH`                        | Mina staking ledger input file.                             |
| `STAKING_LEDGERS_DIRECTORY`                  | Scheduler snapshot directory.                               |
| `STAKING_LEDGERS_HOST_PATH`                  | Host snapshot path mounted into the scheduler.              |
| `START_INDEX` and `END_INDEX`                | Trace or proof batch range.                                 |
| `CHECKPOINT_INTERVAL`                        | Positive trace indices between S3 checkpoints.              |
| `CHECKPOINT_S3_URI`                          | S3 prefix for trace checkpoint storage.                     |
| `LEDGER_HASH`                                | Ledger hash stored with a trace checkpoint.                 |
| `EXPECTED_LEDGER_HASH`                       | Required hash for checkpoint restoration.                   |
| `EXPECTED_ROOT_HASH`                         | Optional expected root for `staking-ledger get-root-hash`.  |
| `VOTE_ACTIONS_PATH`                          | Vote action JSON input.                                     |
| `VOTE_REDUCER_PROOF_PATH`                    | Final Vote Reducer proof JSON.                              |
| `STAKING_LEDGER_TO_VOTING_LEDGER_PROOF_PATH` | Final staking proof JSON.                                   |
| `PROOF_OUTPUT_PATH`                          | Explicit proof output file.                                 |
| `PROPOSAL_ACTIONS_OUTPUT_PATH`               | Fetched action output file.                                 |
| `CACHE_PATH`                                 | Optional compile cache path.                                |
| `LOG_LEVEL`                                  | SDK log level.                                              |

## Queue and scheduler fields

| Field                                           | Purpose                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `REDIS_HOST` and `REDIS_PORT`                   | BullMQ connection.                       |
| `QUEUE_NAME`                                    | CLI worker or proof task queue.          |
| `PROVING_QUEUE_NAME`                            | Compose proving queue name.              |
| `PROVING_WORKER_REPLICAS`                       | Compose proving worker count.            |
| `TASK_ATTEMPTS`                                 | Queue retry count.                       |
| `TASK_BACKOFF_MS`                               | Queue retry backoff.                     |
| `TASK_KEEP_COMPLETED`                           | Completed jobs kept in Redis. Default: `100`. |
| `TASK_KEEP_FAILED`                              | Failed jobs kept in Redis. Default: `200`.    |
| `MAX_TASK_DURATION_MS`                          | Worker task timeout.                     |
| `VOTING_LEDGER_SCHEDULER_POLL_INTERVAL_MS`      | Node scheduler poll interval.            |
| `VOTING_LEDGER_SCHEDULER_POLL_INTERVAL_SECONDS` | Compose scheduler poll interval.         |
| `PROVING_SCHEDULER_POLL_INTERVAL_SECONDS`       | Compose proving scheduler poll interval. |
| `PROVING_OUTPUT_DIRECTORY`                      | Final proof output directory.            |

## API, Indexer, and Processor fields

| Field                             | Default or rule      | Purpose                        |
| --------------------------------- | -------------------- | ------------------------------ |
| `ARCHIVE_NODE_URL`                | Required             | Archive GraphQL endpoint.      |
| `TREASURY_OWNER_CONTRACT_ADDRESS` | Required             | Indexed Owner address.         |
| `DATABASE_URL`                    | Required             | Postgres connection.           |
| `DATABASE_SCHEMA`                 | `public`             | Postgres schema.               |
| `API_PORT`                        | `4000`               | App API port.                  |
| `API_URL`                         | Derived from port    | App API service URL.           |
| `INDEXER_API_PORT`                | `4001`               | Indexer API port.              |
| `INDEXER_API_URL`                 | Derived from port    | Indexer API service URL.       |
| `PROCESSOR_API_PORT`              | `4002`               | Processor API port.            |
| `PROCESSOR_API_URL`               | Derived from port    | Processor API service URL.     |
| `API_PAGE_LIMIT_DEFAULT`          | `50`                 | Default page size.             |
| `API_PAGE_LIMIT_MAX`              | `200`                | Maximum page size.             |
| `POLL_PENDING_INTERVAL_MS`        | `5000`               | Pending block poll interval.   |
| `POLL_CANONICAL_INTERVAL_MS`      | `15000`              | Canonical block poll interval. |
| `POLL_EVENTS_INTERVAL_MS`         | Legacy fallback      | Shared poll interval fallback. |
| `EVENTS_BLOCK_BATCH_SIZE`         | `10`                 | Archive block batch size.      |
| `EVENTS_START_HEIGHT`             | `0`                  | First block on a cold start.   |
| `PENDING_OVERLAP_BLOCKS`          | `20`                 | Pending re-read overlap.       |
| `CANONICAL_OVERLAP_BLOCKS`        | `100`                | Canonical re-read overlap.     |
| `ORPHAN_DEPTH_BLOCKS`             | `30`                 | Orphan handling depth.         |
| `PROCESSOR_NAME`                  | `proposal-processor` | Processor offset namespace.    |
| `PROCESSOR_POLL_INTERVAL_MS`      | `2000`               | Processor poll interval.       |
| `PROCESSOR_BATCH_SIZE`            | `200`                | Events per processor batch.    |
| `ARCHIVE_REQUEST_TIMEOUT_MS`      | `15000`              | Archive request timeout.       |
| `PROPOSAL_CONTENT_MAX_CHARS`      | `32768`              | Proposal content limit.        |
| `PROPOSAL_CONTENT_MAX_BYTES`      | Legacy fallback      | Content limit fallback.        |
| `CORS_ALLOWED_ORIGINS`            | Local web origins    | Allowed browser origins.       |

## Web and backoffice fields

| Field                                                               | Purpose                            |
| ------------------------------------------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_BUILD_SHA`                                             | Displayed build identity.          |
| `NEXT_PUBLIC_NETWORK_ID`                                            | Browser signing network.           |
| `NEXT_PUBLIC_TREASURY_API_URL`                                      | App API URL.                       |
| `NEXT_PUBLIC_API_URL`                                               | App API fallback alias.            |
| `NEXT_PUBLIC_INDEXER_API_URL`                                       | Indexer API URL.                   |
| `NEXT_PUBLIC_PROCESSOR_API_URL`                                     | Processor API URL.                 |
| `NEXT_PUBLIC_MINA_NODE_URL`                                         | Browser Mina GraphQL URL.          |
| `NEXT_PUBLIC_BACKOFFICE_MINA_NODE_URL`                              | Backoffice Mina GraphQL URL.       |
| `NEXT_PUBLIC_TREASURY_OWNER_CONTRACT_ADDRESS`                       | Browser Owner address.             |
| `NEXT_PUBLIC_MULTISIG_PARTICIPANTS_PUBLIC_KEYS`                     | Backoffice ordered signer keys.    |
| `NEXT_PUBLIC_LEDGER_SIGNER_PUBLIC_KEY`                              | Browser Ledger signer public key.  |
| `NEXT_PUBLIC_LEDGER_SIGNER_ACCOUNT_INDEX`                           | Browser Ledger account index.      |
| `NEXT_PUBLIC_LIFECYCLE_PERIOD_DURATION`                             | Browser contract compile duration. |
| `NEXT_PUBLIC_SLOT_DURATION_MS`                                      | Browser time estimate per slot.    |
| `NEXT_PUBLIC_PROOFS_ENABLED`                                        | Browser prover mode.               |
| `NEXT_PUBLIC_VOTE_REDUCER_VERIFICATION_KEY_JSON`                    | Vote proof verification key.       |
| `NEXT_PUBLIC_STAKING_LEDGER_TO_VOTING_LEDGER_VERIFICATION_KEY_JSON` | Staking proof verification key.    |
| `NEXT_PUBLIC_TREASURY_PROPOSAL_VERIFICATION_KEY_JSON`               | Proposal verification key.         |
| `NEXT_PUBLIC_EMPTY_VOTING_LEDGER_ROOT`                              | Required empty voting root.        |
| `NEXT_PUBLIC_EMPTY_NULLIFIER_ROOT`                                  | Required empty nullifier root.     |

Set `NEXT_PUBLIC_SLOT_DURATION_MS=90000` for a Mesa network. Some local and
bootstrap defaults still use the Berkeley value `180000`. This field changes
only the browser time estimate. It does not change Mina consensus or the
compiled Treasury lifecycle duration.

See [Voting Capacity and Period Sizing](../lifecycle/voting-capacity-and-period-sizing.md)
for the Mesa epoch calculation.

## Local blockchain fields

| Field                               | Purpose                                        |
| ----------------------------------- | ---------------------------------------------- |
| `MINA_NODE_HOST`                    | Local service bind host.                       |
| `MINA_NODE_PORT`                    | Local Mina GraphQL port.                       |
| `MINA_ARCHIVE_PORT`                 | Local Archive GraphQL port.                    |
| `LIGHTNET_ACCOUNT_MANAGER_ENDPOINT` | Lightnet account manager endpoint.             |
| `MINA_BINARY`                       | Mina binary used by local development scripts. |

## Compose deployment fields

| Function                      | Fields                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images and build identity     | `APP_IMAGE`, `WEB_IMAGE`, `BACKOFFICE_IMAGE`, `BUILD_SHA`                                                                                                |
| Database bootstrap            | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                                                                                      |
| Service bind and ports        | `BIND_ADDRESS`, `WEB_PORT`, `BACKOFFICE_PORT`, `PROXY_API_PORT`, `PROXY_BACKOFFICE_PORT`, `PROXY_INDEXER_PORT`, `PROXY_PROCESSOR_PORT`, `PROXY_WEB_PORT` |
| Public proxy bind and ports   | `PROXY_PUBLIC_BIND_ADDRESS`, `PROXY_HTTP_PORT`, `PROXY_HTTPS_PORT`                                                                                       |
| Proxy and container upstreams | `MINA_NODE_PROXY_UPSTREAM`, `ARCHIVE_NODE_PROXY_UPSTREAM`, `COMPOSE_ARCHIVE_NODE_URL`                                                                    |
| Public domains                | `PUBLIC_API_DOMAIN`, `PUBLIC_INDEXER_DOMAIN`, `PUBLIC_PROCESSOR_DOMAIN`, `PUBLIC_WEB_DOMAIN`                                                             |
| TLS certificate setup         | `LETSENCRYPT_EMAIL`, `LETSENCRYPT_ACME_CA`                                                                                                               |

## Docs, landing page, and application URL flow

The documentation site and the treasury application are separate web
surfaces. The documentation landing page connects them with links.

| Field                           | Consumer                    | Read time        | Purpose                                           |
| ------------------------------- | --------------------------- | ---------------- | ------------------------------------------------- |
| `DOCS_URL`                      | Docusaurus                  | Docs build       | Sets the documentation origin.                    |
| `DOCS_BASE_URL`                 | Docusaurus                  | Docs build       | Sets the documentation path below the origin.     |
| `TREASURY_APP_URL`              | Docusaurus landing and menu | Docs build       | Sets each `Open Treasury` link.                   |
| `PUBLIC_WEB_DOMAIN`             | Public Caddy proxy          | Proxy start      | Publishes the treasury application through HTTPS. |
| `NEXT_PUBLIC_TREASURY_API_URL`  | Treasury application        | Application load | Sets the browser Treasury API URL.                |
| `NEXT_PUBLIC_INDEXER_API_URL`   | Treasury application        | Application load | Sets the browser Indexer API URL.                 |
| `NEXT_PUBLIC_PROCESSOR_API_URL` | Treasury application        | Application load | Sets the browser Processor API URL.               |
| `NEXT_PUBLIC_MINA_NODE_URL`     | Treasury application        | Application load | Sets the browser Mina GraphQL URL.                |

`PUBLIC_WEB_DOMAIN` controls the application ingress. It does not set
`TREASURY_APP_URL`. Give both fields the same application domain, with the
required scheme in `TREASURY_APP_URL`.

The public proxy publishes the application services below
`PUBLIC_WEB_DOMAIN`. The browser URLs can use the same origin with `/api`,
`/indexer`, `/processor`, and `/mina/graphql` paths.

The treasury application reads its `NEXT_PUBLIC_*` values from the container
environment at request time. One application image can therefore support
different deployments. The static docs site cannot read container values.

### Local URL configuration

The default local configuration uses these values:

```env
DOCS_URL=https://minafoundation.github.io
DOCS_BASE_URL=/decentralised-treasury/
TREASURY_APP_URL=http://127.0.0.1:3100
```

Run the docs server on port `3300`. The landing page opens the application on
port `3100`.

### Hosted URL configuration

Use a dedicated docs domain and application domain when both are available:

```env
DOCS_URL=https://docs.treasury.example.com
DOCS_BASE_URL=/
TREASURY_APP_URL=https://treasury.example.com
PUBLIC_WEB_DOMAIN=treasury.example.com
NEXT_PUBLIC_TREASURY_API_URL=https://treasury.example.com/api
NEXT_PUBLIC_INDEXER_API_URL=https://treasury.example.com/indexer
NEXT_PUBLIC_PROCESSOR_API_URL=https://treasury.example.com/processor
NEXT_PUBLIC_MINA_NODE_URL=https://treasury.example.com/mina/graphql
```

Set `DOCS_URL`, `DOCS_BASE_URL`, and `TREASURY_APP_URL` in the docs build job.
Set `PUBLIC_WEB_DOMAIN` in `<DEVOPS_ENV_FILE>`. Set the `NEXT_PUBLIC_*` URLs in
`<WEB_ENV_FILE>`.

Build the docs after you set the three docs fields:

```bash
DOCS_URL=https://docs.treasury.example.com \
DOCS_BASE_URL=/ \
TREASURY_APP_URL=https://treasury.example.com \
pnpm docs:build
```

If the docs use GitHub Pages, keep the repository path in `DOCS_BASE_URL`.
For a custom root domain, use `/`.

`NODE_ENV` selects the standard development or production build mode. It does
not set an origin or connect the two web surfaces.

## Sources

See the [complete CLI command reference](./cli-commands.md) for the command and
option matrix.

- `devops/scripts/bootstrap-env.mjs`
- `devops/scripts/export-public-deployment-config.mjs`
- `devops/compose.yml`
- `apps/api/src/config.ts`
- `apps/api`
- `apps/backoffice`
- `apps/cli`
- `apps/web`
- `apps/web/features/runtime-config/lib/runtime-config-fields.ts`
- `apps/web/features/ledger/lib/ledger-signing.ts`
- `apps/backoffice/features/runtime-config.ts`
- `apps/backoffice/next.config.js`
- `apps/docs/docusaurus.config.ts`
- `apps/cli/src/commands/treasury-owner.ts`
- `apps/cli/src/commands/proposal.ts`
- `apps/cli/src/commands/pause-controller.ts`
- `apps/cli/src/commands/staking-ledger-to-voting-ledger.ts`
- `apps/cli/src/commands/vote-reducer.ts`
- `devops/docker/voting-ledger-scheduler-entrypoint.sh`
- `apps/cli/src/ledger/transaction-signer.ts`
- `packages/sdk/src/proving/task-queue.ts`
- `packages/sdk/src/proving/worker.ts`
- `packages/sdk/src/logging/logger.ts`
- `packages/sdk/src/storage/sqlite/sqlite-db-path.ts`
- `devops/runbooks/2-Treasury/2b-Deploy-Contracts/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/README.md`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/helmfile.yaml`
- `devops/runbooks/2-Treasury/2c-Deploy-Stack/verification-keys.yaml`
