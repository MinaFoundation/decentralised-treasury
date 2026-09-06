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
    assert.equal(createdServices[0]?.closed, true);

    const service = await registry.getService("1");
    assert.equal(createCalls, 2);
    assert.equal(createdServices[1]?.started, true);
    assert.equal(await service.getVoteWeight("B62dummy"), 42n);

    await registry.close();
    assert.equal(createdServices[1]?.closed, true);
  });

  it("shares one startup across concurrent lookups", async () => {
    let createCalls = 0;
    const registry = new LifecycleVotingLedgerServiceRegistry(() => {
      createCalls += 1;
      return new StubVotingLedgerService(false, 7n);
    });

    const [first, second] = await Promise.all([
      registry.getService("2"),
      registry.getService("2"),
    ]);

    assert.equal(first, second);
    assert.equal(createCalls, 1);
    await registry.close();
  });

  it("waits for an in-flight startup and closes its service", async () => {
    let releaseStart: (() => void) | undefined;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const service = new StubVotingLedgerService(false, 9n);
    service.start = async () => {
      await startGate;
      service.started = true;
    };
    const registry = new LifecycleVotingLedgerServiceRegistry(() => service);

    const lookup = registry.getService("3");
    const close = registry.close();
    releaseStart?.();

    await assert.rejects(lookup, /closing or closed/);
    await close;
    assert.equal(service.closed, true);
    await assert.rejects(registry.getService("3"), /closing or closed/);
  });

  it("rejects lifecycle ids outside the contract UInt32 domain", async () => {
    const registry = new LifecycleVotingLedgerServiceRegistry(
      () => new StubVotingLedgerService(false, 1n),
    );

    await assert.rejects(registry.getService("4294967296"), /unsigned 32-bit/);
    await registry.close();
  });
});
