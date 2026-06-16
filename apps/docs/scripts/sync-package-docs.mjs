import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const docsAppRoot = path.resolve(appRoot, "..");
const repoRoot = path.resolve(docsAppRoot, "../..");
const outputRoot = path.join(docsAppRoot, "docs");

const frontmatter = (title, sidebarLabel = title) =>
  `---\ntitle: ${title}\nsidebar_label: ${sidebarLabel}\n---\n\n`;

const writeDoc = async (relativePath, title, body, sidebarLabel = title) => {
  const targetPath = path.join(outputRoot, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${frontmatter(title, sidebarLabel)}${body.trim()}\n`);
};

const readMarkdown = async (relativePath) =>
  readFile(path.join(repoRoot, relativePath), "utf8");

const stripFrontmatter = (markdown) => markdown.replace(/^---\n[\s\S]*?\n---\n+/, "");

const stripFirstHeading = (markdown) => markdown.replace(/^#\s+.+\n+/, "");

const rewriteLinks = (markdown, replacements) =>
  replacements.reduce(
    (body, [from, to]) => body.replaceAll(from, to),
    markdown,
  );

const copyMarkdown = async ({ source, target, title, sidebarLabel = title, replacements = [] }) => {
  const sourceMarkdown = await readMarkdown(source);
  const body = rewriteLinks(stripFirstHeading(stripFrontmatter(sourceMarkdown)), replacements);
  await writeDoc(target, title, body, sidebarLabel);
};

const specs = [
  ["packages/sdk/specs/provable/provable-primitives.md", "specs/provable/provable-primitives.md", "Provable Primitives"],
  ["packages/sdk/specs/provable/treasury-owner.md", "specs/provable/treasury-owner.md", "Treasury Owner"],
  ["packages/sdk/specs/provable/treasury-proposal.md", "specs/provable/treasury-proposal.md", "Treasury Proposal"],
  ["packages/sdk/specs/provable/treasury-pause-controller.md", "specs/provable/treasury-pause-controller.md", "Treasury Pause Controller"],
  ["packages/sdk/specs/provable/staking-ledger-to-voting-ledger.md", "specs/provable/staking-ledger-to-voting-ledger.md", "Staking Ledger To Voting Ledger"],
  ["packages/sdk/specs/provable/vote-reducer.md", "specs/provable/vote-reducer.md", "Vote Reducer"],
];

const userLinkReplacements = [
  ["../../specs/provable/", "../specs/provable/"],
  ["../provable/", "../developer/provable/"],
  ["../developer/provable/overview.md", "../developer/provable/provable-overview.md"],
  ["../developer/provable/architecture.md", "../developer/provable/provable-architecture.md"],
  ["../developer/provable/workflows.md", "../developer/provable/provable-workflows.md"],
  ["concepts.md", "concepts"],
  ["proposal-lifecycle.md", "proposal-lifecycle"],
  ["voting-and-results.md", "voting-and-results"],
];

const provableDocLinkReplacements = [
  ["../treasury/", "../../user/"],
  ["../../specs/provable/", "../../specs/provable/"],
  ["overview.md", "provable-overview.md"],
  ["architecture.md", "provable-architecture.md"],
  ["workflows.md", "provable-workflows.md"],
  ["testing.md", "../testing.md"],
  ["troubleshooting.md", "../troubleshooting.md"],
  ["reference.md", "../reference/env-and-commands.md"],
];

const developerRootLinkReplacements = [
  ["../treasury/", "../user/"],
  ["../../specs/provable/", "../specs/provable/"],
  ["overview.md", "provable/provable-overview.md"],
  ["architecture.md", "provable/provable-architecture.md"],
  ["workflows.md", "provable/provable-workflows.md"],
  ["testing.md", "testing.md"],
  ["troubleshooting.md", "troubleshooting.md"],
  ["reference.md", "reference/env-and-commands.md"],
];

const developerReferenceLinkReplacements = [
  ["../treasury/", "../../user/"],
  ["../../specs/provable/", "../../specs/provable/"],
  ["overview.md", "../provable/provable-overview.md"],
  ["architecture.md", "../provable/provable-architecture.md"],
  ["workflows.md", "../provable/provable-workflows.md"],
  ["testing.md", "../testing.md"],
  ["troubleshooting.md", "../troubleshooting.md"],
  ["reference.md", "env-and-commands.md"],
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await writeDoc(
  "index.md",
  "Decentralized Treasury Documentation",
  `
This documentation explains the Mina Decentralized Treasury as a living system.

Start with the user guide if you want to understand the treasury from the outside: what proposals are, how voting works, how results are decided, when funds move, and what safety controls exist.

Use the developer guide when you need to run, maintain, extend, test, audit, or debug the implementation.

Use the specifications when you need the source contracts for zkApps, off-chain circuits, proof interfaces, state, and invariants.

## Documentation Layers

- [User guide](user/index.md): product concepts and participant workflows.
- [Developer guide](developer/index.md): architecture, operations, implementation, tests, and troubleshooting.
- [Specifications](specs/index.md): source contracts and design commitments.
`,
  "Documentation Home",
);

await writeDoc(
  "user/index.md",
  "Treasury Overview",
  `
The Mina Decentralized Treasury is a proposal and voting system for coordinating treasury funding decisions on Mina.

Picture a public treasury room. Funds sit in the treasury. Someone brings a funding request into the room. The community has time to read it, vote on it, and see the outcome. If the request passes, funds can be released. If there is an emergency, safety controls can temporarily stop activity.

The website is where most people follow the treasury: proposals, voting windows, results, payouts, and safety status. The command line is for maintainers who need to carry out tasks that are not yet available in the website.

## Start Here

- [Core concepts](concepts.md)
- [Roles and permissions](roles-and-permissions.md)
- [Proposal lifecycle](proposal-lifecycle.md)
- [Voting and results](voting-and-results.md)
- [Using the web app](using-the-web-app.md)
- [Using the command line](using-the-command-line.md)
- [FAQ](faq.md)
`,
);

await copyMarkdown({
  source: "packages/sdk/docs/treasury/concepts.md",
  target: "user/concepts.md",
  title: "Core Concepts",
  sidebarLabel: "Core Concepts",
  replacements: userLinkReplacements,
});

await copyMarkdown({
  source: "packages/sdk/docs/treasury/proposal-lifecycle.md",
  target: "user/proposal-lifecycle.md",
  title: "Proposal Journey",
  replacements: userLinkReplacements,
});

await copyMarkdown({
  source: "packages/sdk/docs/treasury/voting-and-results.md",
  target: "user/voting-and-results.md",
  title: "Voting and Results",
  replacements: userLinkReplacements,
});

await writeDoc(
  "user/roles-and-permissions.md",
  "Roles and Permissions",
  `
Treasury participants do not all do the same work. Some people propose, some vote, some receive funds, some watch the process, and some help keep the process moving.

## Participants

- **Proposal creator** submits a funding request and provides the deposit required for that request.
- **Voter** submits yay, nay, or abstain for a proposal during the voting period.
- **Recipient** receives funds when an approved proposal is paid.
- **Observer** reads proposal state, vote totals, lifecycle status, and payout history.

## Maintainers

Maintainers help with tasks that are not yet handled fully inside the website:

- prepare voting information,
- count and publish proposal results,
- keep public proposal views up to date,
- submit approved payouts when appropriate,
- use the command line for operational actions.

## Emergency Signers

Emergency signers can approve safety actions, such as pausing the whole treasury or pausing a single proposal. This role is separate from ordinary proposal voting.

## Related Docs

- [Pause and governance](pause-and-governance.md)
- [Proposal lifecycle](proposal-lifecycle.md)
- [Using the command line](using-the-command-line.md)
`,
);

await writeDoc(
  "user/lifecycle-calendar.md",
  "Treasury Calendar",
  `
Treasury activity follows a repeated calendar. Each period answers a simple question: can people submit proposals, review proposals, vote, or prepare results?

## Periods

1. **Proposal period**: new proposals can be created.
2. **Exploration period**: participants can review proposals before voting begins.
3. **Voting period**: participants can vote yay, nay, or abstain.
4. **Cooldown period**: voting has ended; results can be prepared.

Payment happens later. This separates the decision from the movement of funds.

## What Users Need To Know

- A proposal can be visible before it is votable.
- A vote can be valid only during the voting period.
- A proposal can be counted only after voting has ended.
- Approval does not automatically pay the recipient.
- Payout follows the payment window and the amount still available for that proposal.

## Related Docs

- [Proposal lifecycle](proposal-lifecycle.md)
- [Voting and results](voting-and-results.md)
`,
);

await writeDoc(
  "user/using-the-web-app.md",
  "Using the Web App",
  `
The website is the main place to follow and use the treasury. It shows what is happening now, what proposals exist, which actions are available, and whether anything is paused.

## What You Can Do

- connect a Mina wallet,
- check the treasury balance,
- see the current period in the treasury calendar,
- browse proposals,
- open a proposal and read its details,
- create a proposal when the calendar allows it,
- vote during the voting period,
- see whether a proposal passed, failed, or is still waiting,
- follow payout progress.

## Reading A Proposal

A proposal page should tell you what is being requested, who would receive the funds, how much is requested, where the proposal is in the calendar, and what action is available next.

## When The Website Looks Behind

Sometimes the website may take time to show the latest activity. If you just created a proposal, voted, or paid a proposal, wait for the public view to refresh before assuming something failed.

## When The Command Line Is Used

Some treasury actions are still handled by maintainers through the command line. The website is the easiest place to understand treasury status; the command line is the maintainer tool for setup, result preparation, payouts, and emergency actions.
`,
);

await writeDoc(
  "user/using-the-command-line.md",
  "Using the Command Line",
  `
The command line is a maintainer tool. It is used when an action needs more control than the website currently provides.

You do not need the command line to read proposals or understand treasury status. Use it only if you are responsible for operating the treasury, preparing results, paying approved proposals, or managing safety actions.

## What It Is Used For

- setting up a local treasury for testing,
- creating or funding the treasury in a controlled environment,
- creating proposals and votes during demos or maintainer workflows,
- preparing vote results after a voting period closes,
- paying approved proposals,
- pausing or unpausing the treasury when emergency signers authorize it.

## How To Think About Commands

Each command represents a treasury action. Before running one, know the proposal, amount, wallet, and treasury period you are working with. After running one, check the website or command output to confirm the treasury moved to the expected state.

## Safety Expectations

Commands can use wallet keys and can move funds. Treat them as operational actions, not casual website clicks. Use test funds in local environments, verify every address and amount, and do not run payment or pause commands unless you are responsible for that treasury action.

## When To Prefer The Website

Use the website when you want to read proposal details, check the current period, inspect vote totals, or understand whether a proposal can be voted on or paid. Use the command line when you need to perform maintainer-only work.
`,
);

await writeDoc(
  "user/support-requirements-and-results.md",
  "Support Requirements And Results",
  `
Approval depends on both participation and support.

Participation asks whether enough voting weight took part in the decision. Support asks whether yay votes met the required share among yay and nay votes.

## How Abstain Works

Abstain contributes to participation, but it does not count as yay support. This lets participants help a proposal reach a valid turnout without supporting or opposing the payout.

## Why Proposal Size Matters

The required participation and approval levels depend on the proposal size and treasury size. Larger requests can require stronger participation or approval.

## What The Result Means

- If participation is too low, the proposal is rejected.
- If there are no yay or nay votes, the proposal is rejected.
- If yay support is too low among yay and nay votes, the proposal is rejected.
- If participation and support pass, the proposal is approved and can later be paid.
`,
);

await writeDoc(
  "user/funding-and-payouts.md",
  "Funding and Payouts",
  `
Treasury funds move only through the proposal journey.

## Funding The Treasury

The treasury holds the funds available for approved proposals. Adding funds increases what the treasury can pay in the future.

## Proposal Deposit

Creating a proposal includes a deposit tied to the requested amount. That deposit is part of the proposal's funding rules and affects the maximum amount that can be paid.

## Approved Does Not Mean Paid

Approval means the proposal passed. Payment is the separate step where funds move to the recipient.

## Partial Payouts

A proposal can be paid in parts. The treasury tracks how much has already been paid and prevents payment beyond the allowed amount.

## Related Docs

- [Proposal journey](proposal-lifecycle.md)
- [Support requirements and results](support-requirements-and-results.md)
- [Using the command line](using-the-command-line.md)
`,
);

await writeDoc(
  "user/pause-and-governance.md",
  "Pause and Governance",
  `
Pause controls protect the treasury when emergency action is needed.

## Whole-Treasury Pause

A treasury-wide pause is an emergency stop. It can block important treasury actions until the authorized safety process turns them back on.

## Single-Proposal Pause

A single proposal can be paused without pausing the whole treasury. This affects that proposal's available actions but does not erase its history or votes.

## Emergency Signers

Pause actions require approval from the emergency signer group. This separates emergency safety decisions from normal treasury voting.

## What Users See

Users should treat pause state as a safety signal. A paused treasury or proposal may still be visible, but some actions can be unavailable until the authorized pause process changes the state.

## Related Docs

- [Roles and permissions](roles-and-permissions.md)
- [Proposal journey](proposal-lifecycle.md)
- [Using the command line](using-the-command-line.md)
`,
);

await writeDoc(
  "user/verifiability-and-trust.md",
  "Trust And Verification",
  `
The treasury is designed so users can trust the result without trusting a single person to count everything by hand.

## What Can Be Checked

- which proposal was voted on,
- which voting round was used,
- how votes were counted,
- whether repeated votes inflated the count,
- whether the final result matches the treasury rules.

## What Users Still Need To Watch

Users should still check the human parts of the process: proposal text, recipient address, requested amount, current calendar period, pause status, and payout progress.

## What Good Operation Looks Like

The website should show proposals and results clearly. Maintainers should publish results after voting closes. Payments should match approved proposals. Emergency pauses should be visible when they are active.

## Related Docs

- [Voting and results](voting-and-results.md)
- [Using the web app](using-the-web-app.md)
`,
);

await writeDoc(
  "user/day-to-day-operation.md",
  "Day-to-Day Operation",
  `
Day to day, the treasury moves through a repeating rhythm:

1. Proposals are created during the proposal period.
2. Participants review proposals during exploration.
3. Voters vote during the voting period.
4. Maintainers prepare and publish results after voting.
5. Approved proposals can be paid in the later payment window.
6. Everyone can follow status from the website.

## Normal Operation

Most users interact through the website. Maintainers use the command line for setup, result preparation, payouts, and safety actions.

## Edge Cases

- A proposal may be visible but not yet votable.
- A vote may take time to appear in the public view.
- A proposal may be approved but not yet paid.
- A payout can be partial.
- Pause controls can temporarily block actions.

## Recovery

Users should look at proposal status, the current calendar period, and recent activity before assuming a proposal has failed. Maintainers can use the command line to recover from operational issues.
`,
);

await writeDoc(
  "user/faq.md",
  "FAQ",
  `
## Why does voting use delegated stake?

Voting power follows Mina staking delegation for the selected voting round. This lets treasury voting use an existing stake-weighted signal.

## Can I vote more than once?

Repeated votes from the same voter do not increase the count. The vote count tracks whether a voter has already contributed weight.

## Why is there an exploration period?

The exploration period creates review time between proposal creation and voting.

## Why can an approved proposal still be unpaid?

Approval and payment are separate. Payment is the action that moves funds.

## Why can users trust the result?

The treasury is designed so the final result can be checked against the rules, even when many votes and voting weights are involved.

## What does pause mean?

Pause is a safety mechanism. A whole-treasury pause affects the whole treasury; a single-proposal pause affects one proposal.
`,
);

await writeDoc(
  "user/glossary.md",
  "Glossary",
  `
## Treasury

The fund-holding system that releases funds through approved proposals.

## Proposal

A funding request with a recipient, amount, calendar stage, status, and payout history.

## Treasury Calendar

The repeating set of periods that controls when proposals can be created, reviewed, voted on, counted, and paid.

## Voting Weight

The amount of influence a voter has in a proposal result. It comes from delegated Mina stake.

## Count

The process that converts votes into yay, nay, and abstain totals and decides whether a proposal is approved or rejected.

## Payment

The step where an approved proposal sends funds from the treasury to the recipient.

## Pause

An emergency safety control that can block treasury or proposal actions.

## Command Line

A maintainer tool for treasury actions that are not yet handled fully inside the website.
`,
);

await writeDoc(
  "developer/index.md",
  "Developer Overview",
  `
The developer guide explains how the Mina Decentralized Treasury is built and operated.

Start here if you need to run the local stack, operate the CLI, understand the API/indexer/processor pipeline, work on the web app, produce proofs, or audit the system against the specs.

## Main Areas

- [System architecture](architecture/system-overview.md)
- [Local development quickstart](local-development/quickstart.md)
- [CLI operations](operations/cli.md)
- [API runtime](apps/api-runtime.md)
- [SDK provable layer](provable/provable-overview.md)
- [Testing strategy](testing.md)
- [Troubleshooting](troubleshooting.md)
`,
);

await writeDoc(
  "developer/architecture/system-overview.md",
  "System Architecture",
  `
The system connects Mina, off-chain proving, event indexing, API projection, and a browser UI.

## End-to-End Flow

1. The CLI or web app submits treasury transactions to a Mina node.
2. Treasury zkApps emit proposal lifecycle events.
3. The indexer reads archive events and persists typed event rows in Postgres.
4. The processor consumes typed events and writes projection tables.
5. The API exposes proposal content, proposal lists, lifecycle data, status endpoints, and ledger witness data.
6. The web app reads Mina GraphQL and API routes to present the treasury.
7. Operators use CLI and SDK services to prepare proof-backed tallies.

## System Surfaces

- **Web app**: user-facing dashboard and proposal interactions.
- **CLI**: operational control surface for deploy, prove, tally, execute, and pause.
- **API app**: app API, indexer API, processor API, indexer worker, processor worker.
- **SDK**: zkApps, circuits, ledgers, storage, services, and workers.
- **Local blockchain**: deterministic local Mina-like runtime for demos and tests.
`,
);

await writeDoc(
  "developer/apps/web-app.md",
  "Web App",
  `
The web app is a client-side Next.js application that renders treasury state and proposal workflows.

## Responsibilities

- connect to wallet state,
- read Mina GraphQL data,
- read treasury/indexer/processor API data,
- show lifecycle status and treasury balance,
- render proposal lists and proposal detail pages,
- prepare proposal, vote, and execution transactions in the browser.

## Source Material

- \`apps/web/README.md\`
- \`apps/web/app/\`
- \`apps/web/features/\`
- \`packages/ui/README.md\`
`,
);

await writeDoc(
  "developer/apps/api-runtime.md",
  "API Runtime",
  `
The API app runs five cooperating processes: indexer worker, processor worker, indexer API, processor API, and app API.

## Runtime Surfaces

- **Indexer worker** polls Archive and writes typed events.
- **Indexer API** serves event and status endpoints.
- **Processor worker** consumes indexed events and writes projections.
- **Processor API** serves projection reads.
- **App API** serves treasury-specific routes such as proposal content and ledger witnesses.

## Operational Dependencies

- Mina archive endpoint,
- Postgres database,
- treasury owner contract address and token id,
- lifecycle SQLite files for staking/voting ledger witness endpoints.

## Source Material

- \`apps/api/README.md\`
- \`apps/api/src/indexer.ts\`
- \`apps/api/src/processor.ts\`
- \`apps/api/src/app-api.ts\`
`,
);

await writeDoc(
  "developer/apps/indexer-and-processor.md",
  "Indexer and Processor",
  `
The indexer and processor turn chain events into application-readable state.

## Indexer

The indexer reads Archive GraphQL events, resolves event type, stores normalized event rows, tracks pending/canonical cursors, and exposes event reads.

## Processor

The processor reads typed events from the indexer API, dispatches them through handlers, and writes projection tables for proposals, votes, nullifiers, tallies, and executions.

## Design Principle

Event type is immutable after ingest. Unknown or unresolved events fail ingestion instead of being patched later.

## Source Material

- \`packages/indexer/README.md\`
- \`packages/processor/README.md\`
- \`apps/api/src/processors/proposals/\`
`,
);

await writeDoc(
  "developer/local-development/quickstart.md",
  "Local Development Quickstart",
  `
The local stack brings up a deterministic treasury environment for development and demos.

## Stack

1. Postgres.
2. Local blockchain with optional archive endpoint.
3. CLI deploy and configuration.
4. API migrations.
5. API runtime.
6. Web app.

## Canonical Environment

Use the repository's checked-in \`.env.dev\` files as the local-development baseline. Older docs may mention \`.env.local-blockchain\`; the canonical local files in this repository are \`.env.dev\`.

## Source Material

- root \`README.md\`
- \`packages/local-blockchain/README.md\`
- \`apps/api/README.md\`
- \`apps/web/README.md\`
- \`apps/cli/README.md\`
`,
);

await writeDoc(
  "developer/local-development/environment.md",
  "Environment",
  `
The treasury stack uses environment variables for Mina endpoints, archive endpoints, database URLs, treasury contract addresses, lifecycle configuration, proof settings, and API URLs.

## Important Groups

- Mina and Archive endpoints.
- Treasury owner address and token id.
- Postgres connection.
- SQLite lifecycle data directory.
- Redis host and port for proof workers.
- Web app public API endpoints.
- Proof enablement flags.

## Local Convention

For this repository, prefer \`.env.dev\` as the local baseline unless a specific deployment or runbook defines another file.
`,
);

await writeDoc(
  "developer/local-development/local-blockchain.md",
  "Local Blockchain",
  `
The local blockchain package provides a Lightnet-style local runtime for deterministic treasury tests and demos.

## Responsibilities

- accept Mina \`sendZkapp\` submissions,
- expose minimal Mina GraphQL queries used by the repo,
- expose minimal archive-compatible queries for the indexer,
- provide admin controls for slot and staking epoch data,
- support deterministic e2e flows.

## Source Material

- \`packages/local-blockchain/README.md\`
- \`packages/local-blockchain/src/\`
- \`packages/local-blockchain/test/\`
`,
);

await writeDoc(
  "developer/operations/cli.md",
  "CLI Operations",
  `
The CLI is the main operator control surface.

## Main Workflows

- compile and deploy treasury contracts,
- fund the treasury,
- create proposals and vote,
- hydrate staking ledgers,
- trace and prove staking-ledger-to-voting-ledger proofs,
- trace and prove vote-reducer proofs,
- tally votes and execute payouts,
- sign and submit pause-controller multisig actions.

## Safety Notes

The current CLI passes private keys through flags or environment variables. Treat it as a development/operator tool and do not use production funds or production keys without a hardened key-management process.

## Source Material

- \`apps/cli/README.md\`
- \`apps/cli/src/commands/\`
- \`apps/cli/test/\`
`,
);

await writeDoc(
  "developer/operations/proving-and-workers.md",
  "Proving and Workers",
  `
Proof generation is split into tracing, queued proving, worker execution, merge orchestration, and final proof use.

## Staking Ledger To Voting Ledger

Operators hydrate staking ledger JSON, trace digest batches with proofs disabled, queue proof jobs, merge compatible proofs, and prove exhaustion.

## Vote Reducer

Operators fetch proposal actions, trace vote batches, queue run-batch proofs, merge by action continuity, and submit the final proof to tallying.

## Worker Runtime

Workers use Redis-backed task queues and execute proof tasks in child processes. Multiple workers can process the same lifecycle queue when they share Redis and queue naming.

## Source Material

- [Provable workflows](../provable/provable-workflows.md)
- \`apps/cli/README.md\`
- \`packages/sdk/src/proving/\`
`,
);

await writeDoc(
  "developer/operations/deployments.md",
  "Deployments",
  `
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

- \`apps/cli/README.md\`
- root \`README.md\`
- [Treasury owner spec](../../specs/provable/treasury-owner.md)
`,
);

for (const [source, target, title, replacements] of [
  ["packages/sdk/docs/provable/overview.md", "developer/provable/provable-overview.md", "Provable Overview"],
  ["packages/sdk/docs/provable/architecture.md", "developer/provable/provable-architecture.md", "Provable Architecture"],
  ["packages/sdk/docs/provable/workflows.md", "developer/provable/provable-workflows.md", "Provable Workflows"],
  ["packages/sdk/docs/provable/testing.md", "developer/testing.md", "Testing Strategy", developerRootLinkReplacements],
  ["packages/sdk/docs/provable/troubleshooting.md", "developer/troubleshooting.md", "Troubleshooting", developerRootLinkReplacements],
  ["packages/sdk/docs/provable/reference.md", "developer/reference/env-and-commands.md", "Environment and Commands", developerReferenceLinkReplacements],
]) {
  await copyMarkdown({
    source,
    target,
    title,
    replacements: replacements ?? provableDocLinkReplacements,
  });
}

await writeDoc(
  "developer/reference/api-routes.md",
  "API Routes",
  `
The API surface is split across app API, indexer API, and processor API.

## App API

- staking ledger account and witness reads,
- voting ledger account reads,
- proposal content validation and submission.

## Indexer API

- event reads,
- indexer status,
- health checks.

## Processor API

- proposal projections,
- vote projections,
- nullifiers,
- tallies,
- executions,
- processor status.

## Source Material

- \`apps/api/README.md\`
- \`apps/api/src/*routes.ts\`
`,
);

await writeDoc(
  "developer/reference/packages.md",
  "Package Reference",
  `
Packages are reference material, not the primary documentation structure.

## SDK

Owns treasury zkApps, off-chain circuits, ledgers, storage, services, workers, and specs.

## Indexer

Owns archive ingestion and indexed-event APIs.

## Processor

Owns typed event consumption and projection APIs.

## UI

Owns shared treasury and wallet UI components used by app surfaces.

## Local Blockchain

Owns deterministic Mina-like local runtime and archive-compatible development endpoints.
`,
);

await writeDoc(
  "developer/contributing.md",
  "Contributing",
  `
Use this page as the developer entry point for code changes.

## Baseline Checks

- Run type checks for changed packages.
- Run relevant unit or integration tests.
- Run Docusaurus sync/build when changing docs.
- Keep user docs user-facing and developer docs evidence-backed.

## Documentation Rule

When adding a new feature, update the relevant spec if behavior or contracts change, update user docs if visible behavior changes, and update developer docs if operation or maintenance changes.
`,
);

await writeDoc(
  "developer/security.md",
  "Security and Key Handling",
  `
The current local/operator tooling is designed for development and controlled operation.

## Key Handling

The CLI can accept private keys through flags or environment variables. This is convenient for development but is not hardened key management.

## Pause Authority

Pause actions use threshold multisig authorization. Participant ordering, nonce binding, and action domain separation are part of the safety model.

## Operational Data

Traces, SQLite files, and Redis queues are operational artifacts. They help produce proofs, but they are not trusted unless the final circuits and treasury zkApps verify the relevant roots and public inputs.
`,
);

await writeDoc(
  "specs/index.md",
  "Specifications",
  `
Specifications are the source contracts for the system. They define the concepts, intended behavior, invariants, interfaces, proof IO, state commitments, and acceptance criteria that user and developer documentation translate.

## Recommended Reading Order

1. [Provable primitives](provable/provable-primitives.md)
2. [Treasury owner](provable/treasury-owner.md)
3. [Treasury proposal](provable/treasury-proposal.md)
4. [Treasury pause controller](provable/treasury-pause-controller.md)
5. [Staking ledger to voting ledger](provable/staking-ledger-to-voting-ledger.md)
6. [Vote reducer](provable/vote-reducer.md)

## Traceability

- User proposal lifecycle maps to treasury owner and treasury proposal specs.
- Voting weight maps to staking-ledger-to-voting-ledger and vote reducer specs.
- Pause and emergency governance map to pause controller, owner, and proposal specs.
- Developer proof workflows map to the circuit specs and provable primitives.
`,
);

for (const [source, target, title] of specs) {
  await copyMarkdown({ source, target, title });
}

console.log("Synced audience-first documentation into apps/docs/docs.");
