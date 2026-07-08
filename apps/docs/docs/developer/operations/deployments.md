---
title: Deployments
sidebar_label: Deployments
---

Deployment connects treasury zkApps, lifecycle timing, pause authority, and operational services.

## Deployment Concerns

- treasury owner and pause controller keypairs,
- multisig participant keys,
- lifecycle deployment slot,
- lifecycle period duration,
- epoch alignment,
- treasury owner address and token id propagation to API and web app,
- proof enablement and worker availability.

## Epoch Alignment

Deployment slot and lifecycle duration should be chosen so proposal snapshots are easy to reason about against Mina staking epochs.

## Source Material

- `apps/cli/README.md`
- root `README.md`
- [Treasury owner spec](../../specs/provable/treasury-owner.md)
