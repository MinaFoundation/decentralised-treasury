import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";
import { PrivateKey } from "o1js";
import treasuryOwnerCommandFactory from "../src/commands/treasury-owner.js";

test("Owner deployment rejects the removed flag and ignores its old environment binding", async () => {
  const previous = process.env.ALLOW_DEPLOY_TO_EXISTING_ACCOUNT;
  process.env.ALLOW_DEPLOY_TO_EXISTING_ACCOUNT = "true";
  try {
    const program = new Command()
      .exitOverride()
      .configureOutput({ writeErr() {} });
    treasuryOwnerCommandFactory(program);
    const deploy = program.commands[0].commands.find(
      (command) => command.name() === "deploy",
    )!;
    for (const option of deploy.options.filter((option) => option.mandatory)) {
      deploy.setOptionValue(option.attributeName(), "test");
    }
    deploy.setOptionValue("signer", "in-memory");
    for (const role of ["sender", "treasuryOwner", "pauseController"]) {
      deploy.setOptionValue(`${role}PrivateKey`, PrivateKey.random());
    }
    let called = false;
    deploy.action(() => {
      called = true;
    });
    await assert.rejects(
      program.parseAsync(
        [
          "treasury-owner",
          "deploy",
          "--allow-deploy-to-existing-account",
          "true",
        ],
        { from: "user" },
      ),
      { code: "commander.unknownOption" },
    );
    assert.equal(called, false);
    await program.parseAsync(["treasury-owner", "deploy"], { from: "user" });
    assert.equal(called, true);
    assert.equal(deploy.opts().allowDeployToExistingAccount, undefined);
    assert.equal(
      deploy.options.some(
        (option) => option.envVar === "ALLOW_DEPLOY_TO_EXISTING_ACCOUNT",
      ),
      false,
    );
  } finally {
    if (previous === undefined)
      delete process.env.ALLOW_DEPLOY_TO_EXISTING_ACCOUNT;
    else process.env.ALLOW_DEPLOY_TO_EXISTING_ACCOUNT = previous;
  }
});
