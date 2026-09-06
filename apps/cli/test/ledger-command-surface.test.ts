import assert from "node:assert/strict";
import test from "node:test";
import type { Command } from "commander";
import { createProgram } from "../src/cli.js";

interface SigningCommandExpectation {
  path: string;
  ledgerIndexOptions: string[];
}

const signingCommands: SigningCommandExpectation[] = [
  {
    path: "transfer",
    ledgerIndexOptions: [
      "senderLedgerAccountIndex",
      "fundingLedgerAccountIndex",
    ],
  },
  {
    path: "multisig-sign pause-treasury",
    ledgerIndexOptions: ["ledgerAccountIndex"],
  },
  {
    path: "multisig-sign unpause-treasury",
    ledgerIndexOptions: ["ledgerAccountIndex"],
  },
  {
    path: "multisig-sign toggle-pause-proposal",
    ledgerIndexOptions: ["ledgerAccountIndex"],
  },
  {
    path: "multisig-sign rotate-multisig-keys",
    ledgerIndexOptions: ["ledgerAccountIndex"],
  },
  {
    path: "pause-controller deploy",
    ledgerIndexOptions: [
      "senderLedgerAccountIndex",
      "pauseControllerLedgerAccountIndex",
    ],
  },
  {
    path: "pause-controller pause-treasury",
    ledgerIndexOptions: ["senderLedgerAccountIndex"],
  },
  {
    path: "pause-controller unpause-treasury",
    ledgerIndexOptions: ["senderLedgerAccountIndex"],
  },
  {
    path: "pause-controller toggle-pause-proposal",
    ledgerIndexOptions: ["senderLedgerAccountIndex"],
  },
  {
    path: "pause-controller rotate-multisig-keys",
    ledgerIndexOptions: ["senderLedgerAccountIndex"],
  },
  {
    path: "proposal create",
    ledgerIndexOptions: ["senderLedgerAccountIndex"],
  },
  {
    path: "proposal vote",
    ledgerIndexOptions: ["senderLedgerAccountIndex", "voterLedgerAccountIndex"],
  },
  {
    path: "proposal tally-votes",
    ledgerIndexOptions: ["senderLedgerAccountIndex"],
  },
  {
    path: "proposal execute",
    ledgerIndexOptions: ["senderLedgerAccountIndex"],
  },
  {
    path: "treasury-owner deploy",
    ledgerIndexOptions: [
      "senderLedgerAccountIndex",
      "treasuryOwnerLedgerAccountIndex",
      "pauseControllerLedgerAccountIndex",
    ],
  },
  {
    path: "treasury-owner fund-treasury",
    ledgerIndexOptions: [
      "senderLedgerAccountIndex",
      "fundingLedgerAccountIndex",
    ],
  },
  {
    path: "treasury-owner emergency-withdraw",
    ledgerIndexOptions: [
      "senderLedgerAccountIndex",
      "treasuryOwnerLedgerAccountIndex",
    ],
  },
];

function commandAt(program: Command, path: string): Command {
  let command = program;
  for (const name of path.split(" ")) {
    const next = command.commands.find(
      (candidate) => candidate.name() === name,
    );
    assert.ok(next, `Missing CLI command ${path}`);
    command = next;
  }
  return command;
}

function leaves(command: Command, prefix: string[] = []): Command[] {
  const path = [...prefix, command.name()];
  if (command.commands.length === 0) return [command];
  return command.commands.flatMap((child) => leaves(child, path));
}

test("every signature-producing CLI command exposes explicit Ledger indices", () => {
  const program = createProgram();
  for (const expectation of signingCommands) {
    const command = commandAt(program, expectation.path);
    const optionNames = new Set(
      command.options.map((option) => option.attributeName()),
    );
    assert.ok(optionNames.has("signer"), `${expectation.path} lacks --signer`);
    if (!expectation.path.startsWith("multisig-sign ")) {
      assert.ok(
        optionNames.has("networkId"),
        `${expectation.path} lacks --network-id`,
      );
    }
    for (const option of expectation.ledgerIndexOptions) {
      assert.ok(
        optionNames.has(option),
        `${expectation.path} lacks the explicit Ledger index option ${option}`,
      );
    }
  }
});

test("every private-key signing leaf is present in the signing matrix", () => {
  const program = createProgram();
  const expected = new Set(signingCommands.map((entry) => entry.path));
  for (const leaf of leaves(program).filter((command) => command !== program)) {
    const optionNames = leaf.options.map((option) => option.attributeName());
    if (!optionNames.some((name) => /PrivateKey$/u.test(name))) continue;
    const path =
      leaf.parent?.parent === program
        ? `${leaf.parent.name()} ${leaf.name()}`
        : leaf.parent === program
          ? leaf.name()
          : `${leaf.parent?.name() ?? ""} ${leaf.name()}`.trim();
    assert.ok(
      expected.has(path),
      `Unclassified private-key signing command: ${path}`,
    );
  }
});

test("proposal create exposes only the sender as an external signing role", () => {
  const command = commandAt(createProgram(), "proposal create");
  const optionNames = new Set(
    command.options.map((option) => option.attributeName()),
  );

  assert.ok(optionNames.has("senderPrivateKey"));
  assert.ok(optionNames.has("senderPublicKey"));
  assert.ok(optionNames.has("senderLedgerAccountIndex"));
  assert.ok(optionNames.has("proposalPrivateKey"));
  assert.ok(!optionNames.has("proposalPublicKey"));
  assert.ok(!optionNames.has("proposalLedgerAccountIndex"));
});

test("treasury-owner deploy exposes the withdrawal permission policy", () => {
  const program = createProgram();
  const command = commandAt(program, "treasury-owner deploy");
  const option = command.options.find(
    (candidate) => candidate.attributeName() === "withdrawalPermission",
  );

  assert.ok(option, "treasury-owner deploy lacks --withdrawal-permission");
  assert.deepEqual(option.argChoices, ["proof", "proofOrSignature"]);
  assert.equal(option.defaultValue, "proof");
  assert.equal(option.envVar, "TREASURY_WITHDRAWAL_PERMISSION");
});
