import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Mina } from "o1js";
import {
  configureMinaNetwork,
  minaNetworkOption,
} from "../src/commands/mina-instance.js";
import { createProgram } from "../src/cli.js";

describe("Mina CLI network configuration", () => {
  it("disables transaction proofs only for explicit PROOFS_ENABLED=false", () => {
    const original = process.env.PROOFS_ENABLED;
    try {
      for (const value of [undefined, "true", "false", "FALSE", ""] as const) {
        if (value === undefined) delete process.env.PROOFS_ENABLED;
        else process.env.PROOFS_ENABLED = value;
        configureMinaNetwork("http://127.0.0.1:8080/graphql", "devnet");
        assert.equal(Mina.getProofsEnabled(), value !== "false");
      }
    } finally {
      if (original === undefined) delete process.env.PROOFS_ENABLED;
      else process.env.PROOFS_ENABLED = original;
    }
  });

  it("sets the explicit o1js signature network", () => {
    configureMinaNetwork("http://127.0.0.1:8080/graphql", "mainnet");
    assert.equal(Mina.getNetworkId(), "mainnet");

    configureMinaNetwork("http://127.0.0.1:8080/graphql", "devnet");
    assert.equal(Mina.getNetworkId(), "devnet");
  });

  it("normalizes supported values and defaults to mainnet", () => {
    const option = minaNetworkOption();

    assert.equal(option.parseArg?.("MAINNET", undefined), "mainnet");
    assert.equal(option.parseArg?.("DeVnEt", undefined), "devnet");
    assert.throws(() => option.parseArg?.("testnet", undefined));
    assert.equal(option.defaultValue, "mainnet");
    assert.equal(option.envVar, "NETWORK");
  });

  it("adds the network option to each command that configures o1js", () => {
    const program = createProgram();
    const commandPaths = [
      ["transfer"],
      ["treasury-owner", "compile"],
      ["treasury-owner", "deploy"],
      ["treasury-owner", "fund-treasury"],
      ["treasury-owner", "emergency-withdraw"],
      ["treasury-owner", "read-state"],
      ["pause-controller", "deploy"],
      ["pause-controller", "compile"],
      ["pause-controller", "read-state"],
      ["pause-controller", "pause-treasury"],
      ["pause-controller", "unpause-treasury"],
      ["pause-controller", "toggle-pause-proposal"],
      ["pause-controller", "rotate-multisig-keys"],
      ["proposal", "create"],
      ["proposal", "vote"],
      ["proposal", "execute"],
      ["proposal", "read-state"],
      ["proposal", "tally-votes"],
      ["vote-reducer", "compile"],
      ["staking-ledger-to-voting-ledger", "compile"],
    ];

    for (const commandPath of commandPaths) {
      let command = program;
      for (const name of commandPath) {
        const child = command.commands.find(
          (candidate) => candidate.name() === name,
        );
        assert(child, `missing CLI command ${commandPath.join(" ")}`);
        command = child;
      }
      const option = command.options.find(
        (candidate) => candidate.attributeName() === "network",
      );
      assert(option, `missing --network on ${commandPath.join(" ")}`);
      assert.equal(option.defaultValue, "mainnet");
    }
  });
});
