---
title: Local Blockchain
sidebar_label: Local Blockchain
---

The local blockchain package provides a Lightnet-style local runtime for deterministic treasury tests and demos.

## Responsibilities

- accept Mina `sendZkapp` submissions,
- expose minimal Mina GraphQL queries used by the repo,
- expose minimal archive-compatible queries for the indexer,
- provide admin controls for slot and staking epoch data,
- support deterministic e2e flows.

## Source Material

- `packages/local-blockchain/README.md`
- `packages/local-blockchain/src/`
- `packages/local-blockchain/test/`
