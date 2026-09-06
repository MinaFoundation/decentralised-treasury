#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  addError,
  docsRoot,
  listFiles,
  printErrors,
  relativeToRepository,
  repositoryRoot,
} from "./lib.mjs";

const CONSTANT_SOURCE_FILES = [
  "packages/sdk/src/provable/contracts/treasury-constants.ts",
  "packages/sdk/src/provable/contracts/treasury-owner.ts",
  "packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts",
  "packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts",
  "packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts",
  "packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts",
  "packages/sdk/src/utils/proposal-content-hash.ts",
  "apps/api/src/proposal-content-routes.ts",
];

const ENV_SOURCE_DIRECTORIES = [
  "apps/api/src",
  "apps/cli/src/commands",
  "apps/cli/src/ledger",
  "apps/web/features/runtime-config",
  "devops/scripts",
  "packages/local-blockchain/src",
  "packages/sdk/src",
];

const ENV_SOURCE_FILES = [
  "apps/api/src/config.ts",
  "apps/backoffice/features/runtime-config.ts",
  "apps/backoffice/next.config.js",
  "apps/docs/docusaurus.config.ts",
  "apps/web/features/ledger/lib/ledger-signing.ts",
  "devops/compose.yml",
];

const ENV_EXAMPLE_ROOTS = [
  "apps/api",
  "apps/backoffice",
  "apps/cli",
  "apps/web",
  "devops",
  "packages/local-blockchain",
];

async function readRepositoryFile(relativePath) {
  return await readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function readOptionalRepositoryFile(relativePath) {
  try {
    return await readRepositoryFile(relativePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function exactCodeValues(markdown) {
  return new Set(
    [...markdown.matchAll(/`([^`\r\n]+)`/g)].map((match) => match[1]),
  );
}

function publicMethodNames(source) {
  return [
    ...source.matchAll(
      /\bpublic\s+(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g,
    ),
  ].map((match) => match[1]);
}

function zkProgramMethodNames(source) {
  return [...source.matchAll(/^    ([A-Za-z_$][\w$]*): \{\s*$/gm)].map(
    (match) => match[1],
  );
}

function eventNames(source) {
  return [
    ...source.matchAll(
      /\b[A-Z][A-Z0-9_]*_EVENT_NAME\s*=\s*["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]);
}

async function protocolConstantNames() {
  const sources = new Map();
  for (const file of CONSTANT_SOURCE_FILES) {
    sources.set(file, await readRepositoryFile(file));
  }

  const values = new Set();
  for (const source of sources.values()) {
    for (const match of source.matchAll(
      /\b(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=/g,
    )) {
      // Error-message constants are implementation text. They are not protocol
      // parameters and do not belong in the business-logic constants reference.
      if (!match[1].endsWith("_ERROR")) values.add(match[1]);
    }
    if (/\bmaxProofsVerified\s*=/.test(source)) {
      values.add("maxProofsVerified");
    }
  }

  const ownerSource = sources.get(
    "packages/sdk/src/provable/contracts/treasury-owner.ts",
  );
  for (const match of ownerSource.matchAll(
    /public\s+static\s+([A-Z][A-Z0-9_]*)\s*=/g,
  )) {
    values.add(`LifecyclePeriod.${match[1]}`);
  }

  const proposalSource = sources.get(
    "packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts",
  );
  for (const match of proposalSource.matchAll(
    /public\s+static\s+([A-Z][A-Z0-9_]*)\s*=/g,
  )) {
    values.add(`ProposalStatus.${match[1]}`);
  }

  const voteSource = sources.get(
    "packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts",
  );
  for (const match of voteSource.matchAll(
    /public\s+static\s+([A-Z][A-Z0-9_]*)\s*=/g,
  )) {
    values.add(`Vote.${match[1]}`);
  }

  const multisigSource = sources.get(
    "packages/sdk/src/provable/contracts/treasury-pause-controller/multisig-signatures.ts",
  );
  for (const match of multisigSource.matchAll(
    /private\s+static\s+(?:readonly\s+)?([a-z][A-Za-z0-9_]*)\s*=/g,
  )) {
    values.add(match[1]);
  }

  return [...values].sort();
}

async function cliCommandNames() {
  const entry = await readRepositoryFile("apps/cli/src/cli.ts");
  const commandFiles = [
    ...entry.matchAll(/from\s+["']\.\/commands\/([^"']+)\.js["']/g),
  ].map((match) => `apps/cli/src/commands/${match[1]}.ts`);
  const commands = new Set();

  for (const commandFile of commandFiles) {
    const source = await readRepositoryFile(commandFile);
    const calls = [
      ...source.matchAll(
        /\b(program|command)\s*(?:\r?\n\s*)?\.command\(\s*["']([^"']+)["']/g,
      ),
    ].map((match) => ({ receiver: match[1], name: match[2] }));
    const parents = calls
      .filter((call) => call.receiver === "program")
      .map((call) => call.name);
    const children = calls
      .filter((call) => call.receiver === "command")
      .map((call) => call.name);

    if (children.length > 0 && parents.length === 1) {
      for (const child of children) commands.add(`${parents[0]} ${child}`);
    } else {
      for (const parent of parents) commands.add(parent);
      for (const child of children) commands.add(child);
    }
  }
  return [...commands].sort();
}

function expressRoutes(source) {
  const routes = [];
  const pattern = /\bapp\.(get|post|put|delete|patch)\(\s*(["'`])([\s\S]*?)\2/g;
  for (const match of source.matchAll(pattern)) {
    let route = match[3].replaceAll("${indexerPrefix}", "");
    if (route.includes("${")) continue;
    if (!route.startsWith("/")) route = `/${route}`;
    routes.push(`${match[1].toUpperCase()} ${route}`);
  }
  return routes;
}

async function importedRouteFiles(entryFile) {
  const source = await readRepositoryFile(entryFile);
  const directory = path.posix.dirname(entryFile);
  const files = [];
  const importPattern =
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s+["']\.\/([^"']*routes)\.js["']/g;
  for (const match of source.matchAll(importPattern)) {
    if (!/\bcreate[A-Za-z_$][\w$]*Routes\b/.test(match[1])) continue;
    files.push(path.posix.join(directory, `${match[2]}.ts`));
  }
  return files;
}

async function routesFromFiles(files) {
  const routes = new Set();
  for (const file of files) {
    const source = await readRepositoryFile(file);
    for (const route of expressRoutes(source)) routes.add(route);
  }
  return routes;
}

async function apiCoverage() {
  const appFiles = [
    "apps/api/src/http-api-server.ts",
    ...(await importedRouteFiles("apps/api/src/app-api.ts")),
  ];
  const indexerFiles = [
    "packages/indexer/src/events-api-server.ts",
    ...(await importedRouteFiles("apps/api/src/indexer-api.ts")),
  ];
  const processorFiles = [
    "apps/api/src/http-api-server.ts",
    ...(await importedRouteFiles("apps/api/src/processor-api.ts")),
  ];
  const processorRoutes = await routesFromFiles(processorFiles);
  const processorCrudSource = await readRepositoryFile(
    "apps/api/src/processor-crud-routes.ts",
  );
  for (const match of processorCrudSource.matchAll(/routePath:\s*["']([^"']+)["']/g)) {
    processorRoutes.add(`GET /${match[1]}`);
    processorRoutes.add(`GET /${match[1]}/:id`);
  }
  return [
    {
      page: "operate/api/app-api.md",
      values: [...(await routesFromFiles(appFiles))].sort(),
      surface: "App API routes",
    },
    {
      page: "operate/api/indexer-api.md",
      values: [...(await routesFromFiles(indexerFiles))].sort(),
      surface: "Indexer API routes",
    },
    {
      page: "operate/api/processor-api.md",
      values: [...processorRoutes].sort(),
      surface: "Processor API routes",
    },
  ];
}

function collectEnvironmentNames(source, names) {
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g,
    /\.env\(\s*["']([A-Z][A-Z0-9_]*)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }

  for (const match of source.matchAll(/\b(?:envNames|names):\s*\[([\s\S]*?)\]/g)) {
    for (const name of match[1].matchAll(/["']([A-Z][A-Z0-9_]*)["']/g)) {
      names.add(name[1]);
    }
  }
}

async function environmentNames() {
  const names = new Set();
  const sourceFiles = [...ENV_SOURCE_FILES];
  for (const directory of ENV_SOURCE_DIRECTORIES) {
    sourceFiles.push(
      ...(await listFiles(path.join(repositoryRoot, directory), [
        ".ts",
        ".tsx",
        ".js",
        ".mjs",
        ".cjs",
      ])).map((file) => relativeToRepository(file)),
    );
  }
  for (const file of new Set(sourceFiles)) {
    const source = await readOptionalRepositoryFile(file);
    if (source !== null) collectEnvironmentNames(source, names);
  }
  const composeSource = await readRepositoryFile("devops/compose.yml");
  for (const match of composeSource.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?=[:}])/g)) {
    names.add(match[1]);
  }
  const apiConfig = await readRepositoryFile("apps/api/src/config.ts");
  for (const match of apiConfig.matchAll(/["']([A-Z][A-Z0-9_]*)["']/g)) {
    names.add(match[1]);
  }

  for (const root of ENV_EXAMPLE_ROOTS) {
    const directory = path.join(repositoryRoot, root);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !/^\.env.*\.example$/.test(entry.name)) continue;
      const source = await readFile(path.join(directory, entry.name), "utf8");
      for (const match of source.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) {
        names.add(match[1]);
      }
    }
  }
  for (const name of [...names]) {
    if (name.endsWith("_")) names.delete(name);
  }
  return [...names].sort();
}

async function coverageRecords() {
  const ownerSource = await readRepositoryFile(
    "packages/sdk/src/provable/contracts/treasury-owner.ts",
  );
  const proposalSource = await readRepositoryFile(
    "packages/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.ts",
  );
  const pauseSource = await readRepositoryFile(
    "packages/sdk/src/provable/contracts/treasury-pause-controller/treasury-pause-controller.ts",
  );
  const stakingProgramSource = await readRepositoryFile(
    "packages/sdk/src/provable/staking-ledger-to-voting-ledger.ts",
  );
  const voteProgramSource = await readRepositoryFile(
    "packages/sdk/src/provable/contracts/treasury-proposal/vote-reducer.ts",
  );
  const eventSource = await readRepositoryFile(
    "packages/sdk/src/provable/events/treasury-proposal-events.ts",
  );

  return [
    {
      page: "operate/reference/treasury-owner.md",
      values: publicMethodNames(ownerSource),
      surface: "Treasury Owner methods",
    },
    {
      page: "operate/reference/treasury-proposal.md",
      values: [...publicMethodNames(proposalSource), "recipientHash", "paidOutAmount"],
      surface: "Treasury Proposal methods and principal state",
    },
    {
      page: "operate/reference/pause-controller.md",
      values: [...publicMethodNames(pauseSource), "multisigCommitment", "paused"],
      surface: "Pause Controller methods and state",
    },
    {
      page: "operate/reference/staking-ledger-to-voting-ledger.md",
      values: [
        ...zkProgramMethodNames(stakingProgramSource),
        "StakingLedgerToVotingLedgerProgramInput",
        "StakingLedgerToVotingLedgerProgramOutput",
        "SideLoadedStakingLedgerToVotingLedgerProof",
        "StakingLedgerToVotingLedgerProof",
        "ACCOUNT_BATCH_SIZE",
      ],
      surface: "staking-ledger-to-voting-ledger ZkProgram",
    },
    {
      page: "operate/reference/vote-reducer.md",
      values: [
        ...zkProgramMethodNames(voteProgramSource),
        "VoteReducerPublicInput",
        "VoteReducerPublicOutput",
        "SideLoadedVoteReducerProof",
        "VoteReducerProof",
        "VOTE_ACTION_BATCH_SIZE",
      ],
      surface: "Vote Reducer ZkProgram",
    },
    {
      page: "operate/reference/events.md",
      values: eventNames(eventSource),
      surface: "Treasury events",
    },
    {
      page: "operate/reference/constants-and-acceptance.md",
      values: await protocolConstantNames(),
      surface: "protocol constants",
    },
    {
      page: "operate/reference/cli-commands.md",
      values: await cliCommandNames(),
      surface: "CLI commands",
    },
    {
      page: "operate/reference/environment-fields.md",
      values: await environmentNames(),
      surface: "environment fields",
    },
    ...(await apiCoverage()),
  ];
}

export async function validateCoverage() {
  const errors = [];
  for (const record of await coverageRecords()) {
    const file = path.join(docsRoot, record.page);
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      addError(
        errors,
        relativeToRepository(file),
        `Cannot read the coverage page: ${error.message}`,
      );
      continue;
    }
    if (record.values.length === 0) {
      addError(
        errors,
        relativeToRepository(file),
        `Source extraction returned no ${record.surface}.`,
      );
      continue;
    }
    const documentedValues = exactCodeValues(text);
    for (const value of new Set(record.values)) {
      if (!documentedValues.has(value)) {
        addError(
          errors,
          relativeToRepository(file),
          `The page does not cover source-derived ${record.surface} value ${value}.`,
        );
      }
    }
  }
  return errors;
}

async function main() {
  const errors = await validateCoverage();
  printErrors(errors);
  if (errors.length > 0) process.exitCode = 1;
  else
    process.stdout.write(
      "Source-derived identifier-presence coverage passed for contracts, proofs, constants, commands, events, environment fields, and API routes.\n",
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
