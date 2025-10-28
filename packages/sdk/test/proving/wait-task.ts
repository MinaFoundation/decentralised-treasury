import { VotingAccountInMemoryService } from "../../src/services/voting-account-service.js";
import {
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
} from "../../src/provable/staking-ledger-to-voting-ledger.js";
import { Task, TaskStatus } from "../../src/proving/task-queue.js";
import { Cache } from "o1js";
import { PrefixedMerkleTree36InMemoryService } from "../../src/services/merkle-tree-service.js";
import { MerkleTree256InMemoryService } from "../../src/services/merkle-tree-service.js";
import { readdirSync } from "node:fs";

const stakingLedgerTreeService = new PrefixedMerkleTree36InMemoryService();
const votingLedgerTreeService = new MerkleTree256InMemoryService();
const votingAccountService = new VotingAccountInMemoryService();

stakingLedgerToVotingLedgerContext.set({
  stakingLedgerTree: stakingLedgerTreeService,
  votingLedgerTree: votingLedgerTreeService,
  votingAccounts: votingAccountService,
});

export class BaseTask {
  public static async prepare() {
    throw new Error("Not implemented");
  }
}

export class WaitTask extends BaseTask implements Task<number, string> {
  public name = "wait";
  public id?: number;
  public input: number;

  get serializers() {
    return {
      input: async (input: number) => input.toString(),
      output: async (output: string) => output,
    };
  }

  get deserializers() {
    return {
      input: async (input: string) => Number(input),
      output: async (output: string) => output,
    };
  }

  public static async prepare() {
    console.log("preparing wait task");

    // console.time("compile");
    // const files = readdirSync(`${process.cwd()}/cache`);
    // console.log("files", files);
    // await StakingLedgerToVotingLedger.compile({
    //   cache: Cache.FileSystem(`${process.cwd()}/cache`),
    // });
    // console.timeEnd("compile");
  }

  public async run(waitTime: number) {
    console.log("waiting for", waitTime, "seconds", this.id);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
    return `waited for ${waitTime} seconds`;
    // console.time("compile in worker");
    // console.log("cache path", `${process.cwd()}/cache`);
    // const files = readdirSync(`${process.cwd()}/cache`);
    // console.log("files", files);
    // await StakingLedgerToVotingLedger.compile({
    //   cache: Cache.FileSystem(`${process.cwd()}/cache`),
    // });
    // console.timeEnd("compile in worker");
  }
}
