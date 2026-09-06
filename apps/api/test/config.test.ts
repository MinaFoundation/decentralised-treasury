import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadApiConfig } from "../src/config.js";

const CONTRACT_ADDRESS =
  "B62qikT41XWwfMuoRC1SBvQxBfvHPnYfY7Hm9TUWNQXMLka5eP4xowB";

class ContractWithEvents {
  public readonly events = {
    zEvent: {},
    aEvent: {},
  };

  public constructor(_address: unknown) {}
}

function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ARCHIVE_NODE_URL: "http://archive.example/graphql",
    TREASURY_OWNER_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
    DATABASE_URL: "postgres://database.example/treasury",
    ...overrides,
  };
}

describe("API configuration", () => {
  it("loads defaults and derives deterministic contract event types", () => {
    const config = loadApiConfig(
      { treasuryOwnerContractClass: ContractWithEvents },
      validEnv(),
    );

    assert.equal(config.apiPort, 4_000);
    assert.equal(config.pendingOverlapBlocks, 20);
    assert.deepEqual(config.knownEventTypes, ["aEvent", "zEvent"]);
    assert.deepEqual(config.corsAllowedOrigins, [
      "http://127.0.0.1:3100",
      "http://localhost:3100",
    ]);
  });

  it("rejects partial, fractional, unsafe, and signed integer values", () => {
    const cases: Array<[string, string]> = [
      ["API_PORT", "4000x"],
      ["PROCESSOR_BATCH_SIZE", "1.5"],
      ["ARCHIVE_REQUEST_TIMEOUT_MS", "9007199254740992"],
      ["PENDING_OVERLAP_BLOCKS", "+1"],
      ["CANONICAL_OVERLAP_BLOCKS", "-1"],
    ];

    for (const [name, value] of cases) {
      assert.throws(
        () =>
          loadApiConfig(
            { treasuryOwnerContractClass: ContractWithEvents },
            validEnv({ [name]: value }),
          ),
        new RegExp(`${name} must be`),
      );
    }
  });

  it("accepts zero only for non-negative configuration values", () => {
    const config = loadApiConfig(
      { treasuryOwnerContractClass: ContractWithEvents },
      validEnv({
        PENDING_OVERLAP_BLOCKS: "0",
        CANONICAL_OVERLAP_BLOCKS: " 0 ",
      }),
    );
    assert.equal(config.pendingOverlapBlocks, 0);
    assert.equal(config.canonicalOverlapBlocks, 0);

    assert.throws(
      () =>
        loadApiConfig(
          { treasuryOwnerContractClass: ContractWithEvents },
          validEnv({ API_PORT: "0" }),
        ),
      /API_PORT must be a positive integer/,
    );
  });
});
