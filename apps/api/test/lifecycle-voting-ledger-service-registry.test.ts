import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LifecycleVotingLedgerServiceRegistry,
  type VotingLedgerService,
} from "../src/processors/proposals/lifecycle-voting-ledger-service-registry.js";

class StubVotingLedgerService implements VotingLedgerService {
  public started = false;
  public closed = false;

  public constructor(
    private readonly shouldFailStart: boolean,
    private readonly voteWeight: bigint,
  ) {}

  public async start(): Promise<void> {
    if (this.shouldFailStart) {
      throw new Error("start failed");
    }
    this.started = true;
  }

  public async getVoteWeight(_voterPublicKey: string): Promise<bigint> {
    return this.voteWeight;
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

describe("LifecycleVotingLedgerServiceRegistry", () => {
  it("retries service startup after an initial failure", async () => {
    let createCalls = 0;
    const createdServices: StubVotingLedgerService[] = [];
    const registry = new LifecycleVotingLedgerServiceRegistry(() => {
      createCalls += 1;
      const service = new StubVotingLedgerService(createCalls === 1, 42n);
      createdServices.push(service);
      return service;
    });

    await assert.rejects(registry.getService("1"), /start failed/);

    const service = await registry.getService("1");
    assert.equal(createCalls, 2);
    assert.equal(createdServices[1]?.started, true);
    assert.equal(await service.getVoteWeight("B62dummy"), 42n);

    await registry.close();
    assert.equal(createdServices[1]?.closed, true);
  });
});
