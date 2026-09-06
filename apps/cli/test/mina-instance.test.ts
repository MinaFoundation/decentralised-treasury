import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Mina } from "o1js";
import {
  configureMinaNetwork,
  minaNetworkIdOption,
} from "../src/commands/mina-instance.js";
import { createProgram } from "../src/cli.js";

describe("Mina CLI network configuration", () => {
  it("sets the explicit o1js signature network", () => {
    configureMinaNetwork("http://127.0.0.1:8080/graphql", "mainnet");
    assert.equal(Mina.getNetworkId(), "mainnet");

    configureMinaNetwork("http://127.0.0.1:8080/graphql", "devnet");
    assert.equal(Mina.getNetworkId(), "devnet");

    configureMinaNetwork("http://127.0.0.1:8080/graphql", "testnet");
    assert.equal(Mina.getNetworkId(), "testnet");
  });

  it("defines safe CLI choices and a devnet default", () => {
    const option = minaNetworkIdOption();

    assert.deepEqual(option.argChoices, ["mainnet", "devnet", "testnet"]);
    assert.equal(option.parseArg?.("MAINNET", undefined), "mainnet");
    assert.equal(option.defaultValue, "devnet");
    assert.equal(option.envVar, "MINA_NETWORK_ID");
  });

  it("adds the network option to each command that configures o1js", () => {
    const program = createProgram();
    const commandPaths = [
      ["transfer"],
      ["treasury-owner", "deploy"],
      ["treasury-owner", "fund-treasury"],
      ["treasury-owner", "emergency-withdraw"],
      ["treasury-owner", "read-state"],
      ["pause-controller", "deploy"],
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
        (candidate) => candidate.attributeName() === "networkId",
      );
      assert(option, `missing --network-id on ${commandPath.join(" ")}`);
      assert.equal(option.defaultValue, "devnet");
    }
  });
});
