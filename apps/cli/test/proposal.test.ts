import { Account } from "@repo/sdk/src/provable/account.js";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { findDefaultTokenAccountIndex } from "@repo/sdk/src/utils/default-token-account.js";
import {
  loadPreparedLightnetFixture,
  validatePreparedLightnetFixture,
  selectPreparedProposalLifecycle,
  type PreparedLightnetFixture,
} from "./utils/prepared-lightnet-fixture.js";
import assert from "node:assert";
import { before, describe, it } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Mina, PrivateKey, PublicKey, Reducer, TokenId } from "o1js";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import {
  Vote,
  VoteAction,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { appendActionToHashList } from "@repo/sdk/src/provable/hashing-helpers.js";
import {
  getCurrentGlobalSlot,
  logTestStep,
  parseTreasuryProposalActionsResult,
  parseTreasuryProposalResult,
  parseTreasuryProposalStateResult,
  parseTreasuryProposalVoteResult,
  runCli,
  waitForGlobalSlot,
} from "./utils/cli-test-utils.js";

const FIXTURES_DIRECTORY = fileURLToPath(
  new URL("./fixtures", import.meta.url),
);
const PROPOSAL_TEST_NAME = "proposal.test";

const PROPOSAL_AMOUNT = "10000000000";
const PROPOSAL_MARKDOWN_CONTENT = `# CLI E2E Proposal

This proposal is created from markdown content.
`;
const PROPOSAL_VOTE = "yay";

function votingPhaseStartSlot(
  treasuryDeployedAtSlot: number,
  proposalLifecycleId: number,
  lifecyclePeriodDuration: number,
): number {
  return (
    treasuryDeployedAtSlot +
    lifecyclePeriodDuration * 4 * proposalLifecycleId +
    lifecyclePeriodDuration * 2
  );
}

function createProposalActionsResponse(voteActions: VoteAction[]) {
  const actionStates = [Reducer.initialActionState.toString()];
  let actionHash = Reducer.initialActionState;
  for (const voteAction of voteActions) {
    actionHash = appendActionToHashList(
      actionHash,
      VoteAction.toFields(voteAction),
    );
    actionStates.push(actionHash.toString());
  }

  return {
    data: {
      actions: [
        {
          actionState: {
            actionStateOne:
              actionStates.at(-1) ?? Reducer.initialActionState.toString(),
            actionStateTwo:
              actionStates.at(-2) ?? Reducer.initialActionState.toString(),
            actionStateThree:
              actionStates.at(-3) ?? Reducer.initialActionState.toString(),
            actionStateFour:
              actionStates.at(-4) ?? Reducer.initialActionState.toString(),
            actionStateFive:
              actionStates.at(-5) ?? Reducer.initialActionState.toString(),
          },
          actionData: [
            {
              accountUpdateId: "2",
              data: VoteAction.toFields(voteActions[1]).map((field) =>
                field.toString(),
              ),
              transactionInfo: {
                sequenceNumber: 2,
                zkappAccountUpdateIds: [2],
              },
            },
            {
              accountUpdateId: "1",
              data: VoteAction.toFields(voteActions[0]).map((field) =>
                field.toString(),
              ),
              transactionInfo: {
                sequenceNumber: 1,
                zkappAccountUpdateIds: [1],
              },
            },
          ],
        },
      ],
    },
  };
}

async function startMockArchiveNode(voteActions: VoteAction[]) {
  const responseBody = JSON.stringify(
    createProposalActionsResponse(voteActions),
  );
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(responseBody);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/graphql`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function startMockProposalContentApi(proofInputs: {
  account: ReturnType<typeof Account.toJSON>;
  witness: Record<string, unknown>;
  index: string;
}) {
  const requests: Array<{
    method?: string;
    url?: string;
    body: string;
  }> = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          request.url?.includes("/accounts/")
            ? { index: proofInputs.index }
            : proofInputs,
        ),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      body,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        contentChars: body.length,
        proposalPublicKey: request.url?.split("/")[2] ?? "unknown",
        zkAppUri: "urn:proposal-content:markdown:sha256:test-digest",
        zkAppUriHash: "123456789",
      }),
    );
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

it("exposes proposal fetch-actions command in help", async () => {
  const proposalHelp = await runCli(["proposal", "--help"]);
  assert(
    proposalHelp.includes("fetch-actions"),
    "expected proposal help to list fetch-actions subcommand",
  );
  assert(
    proposalHelp.includes("tally-votes"),
    "expected proposal help to list tally-votes subcommand",
  );
  assert(
    proposalHelp.includes("execute"),
    "expected proposal help to list execute subcommand",
  );
  assert(
    proposalHelp.includes("read-state"),
    "expected proposal help to list read-state subcommand",
  );

  const proposalCreateHelp = await runCli(["proposal", "create", "--help"]);
  assert(
    proposalCreateHelp.includes("--content-file"),
    "expected proposal create help to list --content-file option",
  );
  assert(
    proposalCreateHelp.includes("--api-url"),
    "expected proposal create help to list --api-url option",
  );
  assert(
    !proposalCreateHelp.includes("--proposal-zkapp-uri"),
    "expected proposal create help to not list --proposal-zkapp-uri option",
  );
  assert(
    proposalCreateHelp.includes("--proposal-private-key") &&
      proposalCreateHelp.includes("--proposal-public-key") &&
      proposalCreateHelp.includes("--proposal-ledger-account-index"),
    "expected proposal create help to support both signing modes",
  );
});

it("fetches proposal actions and persists action state target", async () => {
  const treasuryOwnerPrivateKey = PrivateKey.random();
  const treasuryOwnerPublicKey = treasuryOwnerPrivateKey.toPublicKey();
  const proposalPublicKey = PrivateKey.random().toPublicKey();
  const treasuryOwner = new TreasuryOwnerSmartContract(treasuryOwnerPublicKey);
  const expectedTokenId = TokenId.toBase58(treasuryOwner.deriveTokenId());
  const voteActions = [
    new VoteAction({
      vote: Vote.YAY,
      publicKey: PrivateKey.random().toPublicKey(),
    }),
    new VoteAction({
      vote: Vote.NAY,
      publicKey: PrivateKey.random().toPublicKey(),
    }),
  ];
  const archiveNode = await startMockArchiveNode(voteActions);
  const outputPath = join(FIXTURES_DIRECTORY, "proposal-actions-cli-test.json");
  await rm(outputPath, { force: true });

  try {
    const output = await runCli([
      "proposal",
      "fetch-actions",
      "--archive-node-url",
      archiveNode.url,
      "--treasury-owner-public-key",
      treasuryOwnerPublicKey.toBase58(),
      "--proposal-public-key",
      proposalPublicKey.toBase58(),
      "--output-path",
      outputPath,
    ]);
    const parsedOutput = parseTreasuryProposalActionsResult(output);
    assert(parsedOutput, "expected proposal actions JSON output");
    assert.strictEqual(parsedOutput.count, voteActions.length);

    const file = JSON.parse(await readFile(outputPath, "utf8")) as {
      proposalPublicKey: string;
      proposalTokenId: string;
      actionStateHistoryTarget: Record<string, string>;
      voteActions: Array<{ vote: string; publicKey: string }>;
    };

    assert.strictEqual(file.proposalPublicKey, proposalPublicKey.toBase58());
    assert.strictEqual(file.proposalTokenId, expectedTokenId);
    assert.deepStrictEqual(
      file.voteActions.map((voteAction) => voteAction.vote),
      voteActions.map((voteAction) => voteAction.vote.toString()),
    );
    assert.strictEqual(
      file.actionStateHistoryTarget.actionStateOne,
      createProposalActionsResponse(voteActions).data.actions[0].actionState
        .actionStateOne,
    );
  } finally {
    await archiveNode.close();
    await rm(outputPath, { force: true });
  }
});

describe(
  "proposal create e2e",
  { concurrency: 1, skip: !process.env.LIGHTNET_FIXTURE_MANIFEST_PATH },
  () => {
    let fixture: PreparedLightnetFixture;
    let treasuryOwnerPublicKey: string;
    let createdProposalPublicKey: string | undefined;
    let treasuryDeployedAtSlot: number;
    let selectedLifecycleId: number;
    let proofInputs: Parameters<typeof startMockProposalContentApi>[0];

    before(async () => {
      fixture = await loadPreparedLightnetFixture();
      await validatePreparedLightnetFixture(fixture);
      Mina.setActiveInstance(
        Mina.Network({
          mina: fixture.minaNodeUrl,
          networkId: fixture.networkId,
        }),
      );
      treasuryOwnerPublicKey = fixture.ownerPublicKey;
      treasuryDeployedAtSlot = fixture.deployedAtSlot;
      const lifecycle = await selectPreparedProposalLifecycle(fixture, {
        minimumRemainingSlots: Math.ceil(
          fixture.lifecyclePeriodDurationSlots / 2,
        ),
      });
      selectedLifecycleId = lifecycle.lifecycleId;
      const ledger = new SqliteStakingLedgerService({
        lifecycleId: fixture.artifactLifecycleId,
        dbPath: fixture.votingLedgerSqlitePath,
      });
      await ledger.start();
      try {
        const accounts = await ledger.getAllAccounts();
        const index = findDefaultTokenAccountIndex(
          accounts,
          PublicKey.fromBase58(treasuryOwnerPublicKey),
        );
        assert(
          index >= 0,
          "prepared snapshot must contain the default-token Owner",
        );
        proofInputs = {
          account: Account.toJSON(accounts[index]!),
          witness: (await ledger.getWitness(BigInt(index))).toJSON(),
          index: String(index),
        };
      } finally {
        await ledger.close();
      }
    });

    it("creates proposal after treasury owner setup", async () => {
      assert(
        treasuryOwnerPublicKey !== undefined &&
          treasuryDeployedAtSlot !== undefined,
        "expected treasury owner setup to run before test",
      );

      const recipientPublicKey = PrivateKey.random().toPublicKey().toBase58();
      const proposalLifecycleId = selectedLifecycleId;
      const currentSlot = await getCurrentGlobalSlot();
      if (currentSlot < treasuryDeployedAtSlot) {
        await waitForGlobalSlot(treasuryDeployedAtSlot, 300_000);
      }

      logTestStep(PROPOSAL_TEST_NAME, "running proposal create CLI command", {
        treasuryOwnerPublicKey,
        recipientPublicKey,
        proposalLifecycleId,
        lifecyclePeriodDuration: fixture.lifecyclePeriodDurationSlots,
        treasuryDeployedAtSlot,
      });
      const proposalContentPath = join(
        FIXTURES_DIRECTORY,
        "proposal-create-e2e-content.md",
      );
      const contentApi = await startMockProposalContentApi(proofInputs);
      await writeFile(proposalContentPath, PROPOSAL_MARKDOWN_CONTENT, "utf8");
      const createOutput = await runCli(["proposal", "create"], {
        timeoutMs: 600_000,
        streamOutput: true,
        streamLabel: "proposal create e2e",
        envOverrides: {
          SENDER_PRIVATE_KEY: fixture.voters[0]!.privateKey,
          MINA_NODE_URL: fixture.minaNodeUrl,
          NETWORK: fixture.networkId,
          TREASURY_API_URL: contentApi.url,
          TREASURY_OWNER_PUBLIC_KEY: treasuryOwnerPublicKey,
          PROPOSAL_LIFECYCLE_ID: String(proposalLifecycleId),
          RECIPIENT_PUBLIC_KEY: recipientPublicKey,
          PROPOSAL_AMOUNT,
          PROPOSAL_CONTENT_FILE: proposalContentPath,
          LIFECYCLE_PERIOD_DURATION: String(
            fixture.lifecyclePeriodDurationSlots,
          ),
          PROOFS_ENABLED: String(fixture.proofsEnabled),
        },
      }).finally(async () => {
        await contentApi.close();
        await rm(proposalContentPath, { force: true });
      });

      const createResult = parseTreasuryProposalResult(createOutput);
      assert(createResult, "expected proposal create JSON output");
      assert(
        createOutput.includes(
          "The CLI generated an in-memory keypair for deployment and will discard the private key after this command",
        ),
        "expected proposal create to warn about its generated deployment key",
      );
      const proposalPublicKey = createResult.proposalAddress;
      PublicKey.fromBase58(proposalPublicKey);
      assert(createResult.proposalTokenId, "expected proposal token id");
      assert(createResult.proposalTxHash, "expected proposal transaction hash");
      assert.strictEqual(contentApi.requests.length, 1);
      assert.strictEqual(
        contentApi.requests[0]?.url,
        `/proposals/${encodeURIComponent(proposalPublicKey)}/content`,
      );
      assert.deepStrictEqual(JSON.parse(contentApi.requests[0]?.body ?? "{}"), {
        contents: PROPOSAL_MARKDOWN_CONTENT,
      });
      createdProposalPublicKey = createResult.proposalAddress;

      const proposalStateOutput = await runCli(["proposal", "read-state"], {
        timeoutMs: 120_000,
        streamOutput: true,
        streamLabel: "proposal state e2e",
        envOverrides: {
          TREASURY_OWNER_PUBLIC_KEY: treasuryOwnerPublicKey,
          PROPOSAL_PUBLIC_KEY: proposalPublicKey,
        },
      });
      const proposalStateResult =
        parseTreasuryProposalStateResult(proposalStateOutput);
      assert(proposalStateResult, "expected proposal state JSON output");
      assert.strictEqual(
        proposalStateResult.proposalAddress,
        proposalPublicKey,
      );
      assert.strictEqual(
        proposalStateResult.lifecycleId,
        String(proposalLifecycleId),
      );
      assert.strictEqual(proposalStateResult.amount, PROPOSAL_AMOUNT);
    });

    it("casts one fast vote on created proposal", async () => {
      assert(
        treasuryOwnerPublicKey &&
          createdProposalPublicKey &&
          treasuryDeployedAtSlot !== undefined,
        "expected proposal create step to run before vote step",
      );

      const voterPrivateKey = PrivateKey.fromBase58(
        fixture.voters[0]!.privateKey,
      );
      const proposalLifecycleId = selectedLifecycleId;
      const votePhaseStart = votingPhaseStartSlot(
        treasuryDeployedAtSlot,
        proposalLifecycleId,
        fixture.lifecyclePeriodDurationSlots,
      );
      const currentSlot = await getCurrentGlobalSlot();
      if (currentSlot < votePhaseStart) {
        logTestStep(PROPOSAL_TEST_NAME, "waiting for vote phase", {
          currentSlot,
          votePhaseStart,
        });
        await waitForGlobalSlot(
          votePhaseStart,
          Math.max(
            300_000,
            (votePhaseStart - currentSlot + 2) * fixture.slotDurationMs,
          ),
        );
      }

      logTestStep(PROPOSAL_TEST_NAME, "running proposal vote CLI command", {
        treasuryOwnerPublicKey,
        proposalPublicKey: createdProposalPublicKey,
        vote: PROPOSAL_VOTE,
        proposalLifecycleId,
        votePhaseStart,
      });
      const voteOutput = await runCli(["proposal", "vote"], {
        timeoutMs: 600_000,
        streamOutput: true,
        streamLabel: "proposal vote e2e",
        envOverrides: {
          SENDER_PRIVATE_KEY: fixture.voters[0]!.privateKey,
          MINA_NODE_URL: fixture.minaNodeUrl,
          NETWORK: fixture.networkId,
          TREASURY_OWNER_PUBLIC_KEY: treasuryOwnerPublicKey,
          PROPOSAL_PUBLIC_KEY: createdProposalPublicKey,
          VOTER_PRIVATE_KEY: voterPrivateKey.toBase58(),
          PROPOSAL_VOTE: PROPOSAL_VOTE,
          LIFECYCLE_PERIOD_DURATION: String(
            fixture.lifecyclePeriodDurationSlots,
          ),
          PROOFS_ENABLED: String(fixture.proofsEnabled),
        },
      });

      const voteResult = parseTreasuryProposalVoteResult(voteOutput);
      assert(voteResult, "expected proposal vote JSON output");
      assert.strictEqual(voteResult.proposalAddress, createdProposalPublicKey);
      assert(voteResult.voteTxHash, "expected vote transaction hash");
    });
  },
);
