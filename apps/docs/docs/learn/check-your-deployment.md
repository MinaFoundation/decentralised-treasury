---
title: Check Your Treasury Deployment
sidebar_label: Check the deployment
audience: user
page_kind: procedure
---

# Check Your Treasury Deployment

Each Treasury deployment has its own network, contract addresses, and service endpoints.
Confirm these values before you connect a wallet.

## Local Demo Or Shared Deployment

The default documentation build links to `http://127.0.0.1:3100`.
A loopback address opens a service on your own machine. It does not open a shared Treasury.
The navigation labels this target **Open Treasury**.

If you have not started the demo, follow the [local development quickstart](../developer/local-development/quickstart.md).
If you expected a shared deployment, obtain its application URL from the person or organization that supplied the documentation.
This repository does not specify one universal live deployment or a universal support channel.

## Obtain The Public Record

Request the deployment's `public-configuration.json` and its digest through the operator's established communication channel.
The exporter stores this file under `deployments/<DEPLOYMENT_ID>/` in the operator's checkout.
That filesystem path is not automatically a public download URL.

Also request the operator's status page or support contact. Keep that contact with your deployment record.
Do not treat an address in an unsolicited message as the deployment identity.

Open the JSON and inspect its `publicConfiguration` object:

| Field                                                  | Compare with                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `deploymentId` and `sourceRevision`                    | The release identified by the operator.                          |
| `networkId`                                            | The application network and wallet network.                      |
| `addresses.treasuryOwner`                              | The Owner address shown by the application.                      |
| `addresses.pauseController`                            | The controller returned by the direct Owner state read.          |
| `publicEndpoints`                                      | The application, API, and Mina endpoints you use.                |
| `lifecyclePeriodDuration` and `treasuryDeployedAtSlot` | The duration and start slot used for the displayed calendar.     |
| `withdrawalPermission`                                 | Whether this Owner allows the separate emergency signature path. |

Read [Roles](roles.md) and [Pause behavior](pause-behavior.md) before you rely on the withdrawal mode.
A record digest identifies a file. It does not authenticate the operator or prove current chain state.

## Compare Before Participation

1. Open the application URL from the confirmed record.
2. Compare its network and Owner address with the record.
3. Check any browser-local endpoint override in the application settings.
4. Select the same network in your wallet.
5. Stop if an address or network differs.

Use [Verify a proposal](verify-a-proposal.md) for direct content and state checks.
Give the operator the public address, transaction hash, observation time, and error when a check fails.
Never include private keys or recovery phrases in a support request.

## Sources

- `apps/docs/docusaurus.config.ts`
- `apps/docs/src/pages/index.tsx`
- `devops/scripts/export-public-deployment-config.mjs`
- `apps/web/features/runtime-config/lib/get-runtime-config.ts`
- `packages/sdk/src/services/sqlite/sqlite-treasury-owner-service.ts`
