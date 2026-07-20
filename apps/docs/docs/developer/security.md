---
title: Security and Key Handling
sidebar_label: Security and Key Handling
---

The current local/operator tooling is designed for development and controlled operation.

## Key Handling

The CLI can accept private keys through flags or environment variables. This is convenient for development but is not hardened key management.

## Pause Authority

Pause actions use threshold multisig authorization. Participant ordering, nonce binding, and action domain separation are part of the safety model.

## Operational Data

Traces, SQLite files, and Redis queues are operational artifacts. They help produce proofs, but they are not trusted unless the final circuits and treasury zkApps verify the relevant roots and public inputs.
