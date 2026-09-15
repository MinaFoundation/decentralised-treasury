---
title: Service Operation
sidebar_label: Service Operation
sidebar_position: 1
audience: operator
page_kind: navigation
---

# Service Operation

If you run the live-testnet application on one long-running Compose host, these
pages show what each process does. They also show how to start, inspect,
restart, and stop each process safely.

- [Runtime components](./runtime-components.md) identifies each process and dependency.
- [Service procedures](./service-operations.md) gives start, stop, inspection, and restart commands.
- [Compose live-testnet stack](../deployment/compose-testnet.md) gives the complete host, network, snapshot, and startup procedure.

The Compose stack consumes external Mina, Archive, and staking-snapshot
services. These services can come from approved providers or from separately
operated infrastructure.

Use [1a. Archive Node](../infrastructure/archive-node.md) and
[1b. Mina Daemon](../infrastructure/mina-daemon.md) for self-operated cluster
services. Use [2c. Deploy Stack](../infrastructure/deploy-stack.md) and
[2d. Lifecycle Pipeline](../infrastructure/lifecycle-pipeline.md) for the
Kubernetes application stack.

Do not use the o1js simulator, Mina-repository single node, or Docker Lightnet
as the network service for this live operator path.

## Sources

- `devops/README.md`
- `devops/compose.yml`
- `devops/TESTNET.md`
- `devops/runbooks/`
