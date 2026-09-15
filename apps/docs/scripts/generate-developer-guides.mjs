#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  addError,
  docsRoot,
  printErrors,
  relativeToRepository,
  repositoryRoot,
} from "./lib.mjs";

const demoSource = path.join(repositoryRoot, "DEMO.md");
const demoOutput = path.join(
  docsRoot,
  "developer",
  "local-development",
  "full-local-demo.md",
);

function rewriteDemoLinks(markdown) {
  return markdown
    .replaceAll(
      "[User documentation](apps/docs/docs/learn/index.md)",
      "[User documentation](../../learn/index.md)",
    )
    .replaceAll(
      "[Operator documentation](apps/docs/docs/operate/index.md)",
      "[Operator documentation](../../operate/index.md)",
    )
    .replaceAll(
      "[testnet runbook](devops/TESTNET.md)",
      "[Compose live-testnet procedure](../../operate/deployment/compose-testnet.md)",
    )
    .replaceAll(
      "[DevOps README](devops/README.md)",
      "[service procedures](../../operate/services/service-operations.md)",
    )
    .replaceAll(
      "[Mina node runbook](devops/TESTNET_MINA_NODE.md)",
      "[Mina single-node procedure](mina-single-node.md)",
    )
    .replaceAll(
      "](apps/docs/docs/learn/signing-with-ledger-and-auro.md)",
      "](../../learn/signing-with-ledger-and-auro.md)",
    );
}

function renderDemoPage(source) {
  const body = rewriteDemoLinks(source).replace(
    "# Mina Decentralized Treasury Demo",
    "# Full Local Blockchain Demo",
  );
  const firstStep = "\n## 1. Bootstrap Local Env Files";
  if (!body.includes(firstStep)) {
    throw new Error("DEMO.md does not contain the expected first step heading");
  }

  const preparation = `
## Scope

By the end of this demo, you will have deployed and funded a local Treasury,
then created, voted on, tallied, and executed one proposal. The flow uses real
proof generation. Its local helper scripts run the application services in
Compose, but they do not create the live-testnet operator deployment.

The repository simulator keeps the run local and repeatable. It provides only
the Mina surfaces that this project needs; it is not a Mina daemon.

## Before You Start

The flow uses several long-running processes and one generated staking snapshot.
Before you start, make sure that you can meet these conditions:

- use the Node.js version in \`.nvmrc\`;
- enable Corepack and install the locked workspace dependencies;
- start Docker;
- keep at least four terminal sessions available;
- reserve ports \`6379\`, \`8080\`, \`8282\`, \`3100\`, and \`4100\` through \`4102\`;
- reserve a writable \`.data/local-blockchain-ledgers\` directory.

Run the toolchain setup from the repository root:

\`\`\`bash
nvm install
nvm use
corepack enable
CI=true pnpm install --frozen-lockfile
\`\`\`

Complete [Required command tools](tools.md) before the first environment command.
The workspace install does not supply the global environment loader.

## Required Staking Snapshot

Use the repository CLI to create the simulator snapshot after environment
bootstrap. The command reads the generated Treasury Owner and five voter public
keys. It does not write private keys into the snapshot.

The file contains the Treasury Owner account with a nonzero balance. It also
contains five self-delegated voter accounts. Record these values from the
command output:

- the Base58 ledger hash;
- the decimal staking-ledger root field;
- the total default-token currency in nanomina.

Do not continue when the file, root, currency, or generated keys differ. Use
the [automated simulator flow](#automated-simulator-flow) when you do not need
real proofs.
`;

  const augmentedBody = body.replace(firstStep, `${preparation}${firstStep}`);
  const closing = `

## Automated Simulator Flow

If you want a faster confidence check before the manual demo, run the automated
Treasury lifecycle. It deploys, funds, creates, votes, tallies, executes,
advances slots, and checks Archive actions.

\`\`\`bash
PROOFS_ENABLED=false pnpm --dir packages/local-blockchain run test
\`\`\`

This command explicitly selects \`PROOFS_ENABLED=false\`. It checks transaction and simulator
integration, but it does not check real proof generation.

The Compose e2e test has a smaller scope:

\`\`\`bash
pnpm compose:e2e
\`\`\`

It checks deployment, funding, proposal creation, event ingestion, projection,
API content, and web rendering. It does not vote, tally, or execute.

## Stop Or Reset The Demo

When you finish, stop the Compose services first:

\`\`\`bash
pnpm local-blockchain:down
\`\`\`

Stop the local blockchain, Redis, and proof worker with \`Ctrl+C\` in their
terminals. Use this command only when you also want to remove Compose volumes:

\`\`\`bash
pnpm local-blockchain:reset
\`\`\`

The SQLite lifecycle data remains under \`.data/local-blockchain-sqlite\`.
Remove or archive that directory before you reuse lifecycle \`0\` with another
staking snapshot.

## Sources

- \`DEMO.md\`
- \`README.md\`
- \`packages/local-blockchain/README.md\`
- \`packages/local-blockchain/test/local-blockchain-server.test.ts\`
- \`devops/test/compose-e2e.mjs\`
`;

  return `---
title: Full Local Blockchain Demo
sidebar_label: Full local blockchain demo
audience: developer
page_kind: procedure
---

<!-- This file is generated. Change DEMO.md or this generator, then run pnpm --dir apps/docs run generate:developer-guides. -->

${augmentedBody.trim()}${closing}`;
}

export async function expectedDeveloperGuides() {
  const source = await readFile(demoSource, "utf8");
  return [{ output: demoOutput, content: renderDemoPage(source) }];
}

export async function checkDeveloperGuides(expected) {
  const errors = [];
  for (const guide of expected) {
    let current;
    try {
      current = await readFile(guide.output, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        addError(
          errors,
          relativeToRepository(guide.output),
          "The generated Developer guide is missing. Run pnpm --dir apps/docs run generate:developer-guides.",
        );
        continue;
      }
      throw error;
    }
    if (current !== guide.content) {
      addError(
        errors,
        relativeToRepository(guide.output),
        "The generated Developer guide is stale. Run pnpm --dir apps/docs run generate:developer-guides.",
      );
    }
  }
  return errors;
}

async function main() {
  const expected = await expectedDeveloperGuides();
  if (process.argv.includes("--check")) {
    const errors = await checkDeveloperGuides(expected);
    printErrors(errors);
    if (errors.length > 0) process.exitCode = 1;
    else process.stdout.write("The generated Developer guides are current.\n");
    return;
  }

  for (const guide of expected) {
    await mkdir(path.dirname(guide.output), { recursive: true });
    await writeFile(guide.output, guide.content, "utf8");
    process.stdout.write(`Wrote ${relativeToRepository(guide.output)}\n`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
