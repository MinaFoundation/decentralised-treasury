import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import pauseControllerCommandFactory from "../src/commands/pause-controller.js";

const operations = [
  "pause-treasury",
  "unpause-treasury",
  "toggle-pause-proposal",
  "rotate-multisig-keys",
];

test("controller operations parse fee-payer and controller nonces independently", async () => {
  const originalFeePayerNonce = process.env.TX_NONCE;
  const originalControllerNonce = process.env.PAUSE_CONTROLLER_NONCE;
  try {
    delete process.env.TX_NONCE;
    delete process.env.PAUSE_CONTROLLER_NONCE;
    for (const operation of operations) {
      for (const [args, expected] of [
        [[], [undefined, undefined]],
        [
          ["--nonce", "12"],
          [12, undefined],
        ],
        [
          ["--controller-nonce", "0"],
          [undefined, 0],
        ],
        [
          ["--nonce", "12", "--controller-nonce", "3"],
          [12, 3],
        ],
      ] as const) {
        const program = new Command();
        pauseControllerCommandFactory(program);
        const command = program.commands[0]!.commands.find(
          (candidate) => candidate.name() === operation,
        )!;
        // Isolate nonce parsing from the action's unrelated required inputs.
        for (const option of command.options.filter(
          (option) => option.mandatory,
        )) {
          command.setOptionValue(option.attributeName(), "unused");
        }
        command.setOptionValueWithSource("signer", "in-memory", "cli");
        command.setOptionValueWithSource("senderPrivateKey", "unused", "cli");
        let called = false;
        command.action((options) => {
          called = true;
          assert.deepEqual([options.nonce, options.controllerNonce], expected);
        });
        await command.parseAsync([...args], { from: "user" });
        assert.equal(called, true);
      }

      process.env.TX_NONCE = "12";
      process.env.PAUSE_CONTROLLER_NONCE = "3";
      const program = new Command();
      pauseControllerCommandFactory(program);
      const command = program.commands[0]!.commands.find(
        (candidate) => candidate.name() === operation,
      )!;
      for (const option of command.options.filter(
        (option) => option.mandatory,
      )) {
        command.setOptionValue(option.attributeName(), "unused");
      }
      command.setOptionValueWithSource("signer", "in-memory", "cli");
      command.setOptionValueWithSource("senderPrivateKey", "unused", "cli");
      command.action((options) => {
        assert.equal(options.nonce, 12);
        assert.equal(options.controllerNonce, 3);
      });
      await command.parseAsync([], { from: "user" });
      delete process.env.TX_NONCE;
      delete process.env.PAUSE_CONTROLLER_NONCE;
    }
  } finally {
    if (originalFeePayerNonce === undefined) delete process.env.TX_NONCE;
    else process.env.TX_NONCE = originalFeePayerNonce;
    if (originalControllerNonce === undefined)
      delete process.env.PAUSE_CONTROLLER_NONCE;
    else process.env.PAUSE_CONTROLLER_NONCE = originalControllerNonce;
  }
});
