---
title: Deployment Integration
sidebar_label: Deployment integration
audience: developer
page_kind: concept
---

# Deployment Integration

A Treasury deployment is more than a set of contract addresses. It binds the
compiled code, verification keys, lifecycle values, and application
configuration into one release that every component must recognize.

## Compile Order

Compile proof programs before the contracts that embed their verification keys.
Compile the Proposal before the Treasury Owner.

The CLI `treasury-owner compile` command produces the browser configuration.
Use the same source revision and proof mode for deployment and browser values.

## Bound Values

Keep these values consistent:

- lifecycle period duration;
- Treasury deployment slot;
- Treasury Owner and Pause Controller addresses;
- ordered multisig participant keys;
- Proposal verification key;
- Vote Reducer verification key;
- staking-ledger-to-voting-ledger verification key;
- empty voting and nullifier roots.

A runtime environment change cannot change a constant embedded in deployed
contract code.

## Configuration Propagation

After deployment, propagate the Treasury Owner address to the API, web, and
Backoffice environments. Propagate browser proof values to both browser apps.

Use the [configuration change table](../local-development/environment.md#apply-a-configuration-change)
to select a restart, container recreation, or rebuild.
Apply database migrations before new code depends on a changed schema.

## Development And Operator Boundaries

Use the [full local demo](../local-development/full-local-demo.md) for local
integration. Use [Deploy the Treasury](../../operate/deployment/deploy-the-treasury.md)
for the controlled testnet procedure.

Kubernetes source runbooks remain in the Operator section. Developer pages
explain code relationships, not production authorization.

## Checks After A Contract Change

1. Run the affected proof and contract tests.
2. Compile the complete dependency chain.
3. Compare generated browser values with the deployed release.
4. Deploy new local contract accounts.
5. Run the applicable lifecycle integration.
6. Update contract, environment, and CLI reference pages.

## Sources

- `apps/cli/README.md`
- `devops/TESTNET.md`
- `devops/scripts/export-public-deployment-config.mjs`
- `packages/sdk/src/provable/contracts/`
- `apps/docs/docs/operate/deployment/deploy-the-treasury.md`
