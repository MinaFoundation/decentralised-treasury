import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  VotingAccount,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import { Task } from "../task-queue.js";
import { Account } from "../../provable/account.js";
import { Provable, Proof, Cache } from "o1js";
import {
  MerkleTree256InMemoryService,
  MerkleWitness256,
  PrefilledMerkleTree256InMemoryService,
  PrefilledPrefixedMerkleTree36InMemoryService,
  PrefixedMerkleTree36InMemoryService,
  PrefixedMerkleWitness36,
} from "../../services/merkle-tree-service.js";
import {
  PrefilledVotingAccountInMemoryService,
  VotingAccountInMemoryService,
} from "../../services/voting-account-service.js";
import { StakingLedgerToVotingLedgerDigestTrace } from "../tracing/staking-ledger-to-voting-ledger-digest-tracer.js";
import { readdirSync } from "node:fs";

export interface StakingLedgerToVotingLedgerDigestTaskInput
  extends StakingLedgerToVotingLedgerDigestTrace {}

export interface StakingLedgerToVotingLedgerDigestTaskOutput {
  proof: Proof<
    StakingLedgerToVotingLedgerProgramInput,
    StakingLedgerToVotingLedgerProgramOutput
  >;
}

const proofsEnabled = process.env.PROOFS_ENABLED === "true";

export class StakingLedgerToVotingLedgerDigestTask extends Task<
  StakingLedgerToVotingLedgerDigestTaskInput,
  StakingLedgerToVotingLedgerDigestTaskOutput
> {
  public name = "staking-ledger-to-voting-ledger-digest";

  public static async prepare() {
    console.log("compiling staking ledger to voting ledger", {
      proofsEnabled,
    });
    const files = readdirSync(`${process.cwd()}/cache`);
    console.log("cache files", `${process.cwd()}/cache`, files);
    console.time("compile");
    await StakingLedgerToVotingLedger.compile({
      proofsEnabled,
      cache: Cache.FileSystem(`${process.cwd()}/cache`),
    });
    console.timeEnd("compile");
  }

  public get serializers() {
    console.log("returning serializers");
    return {
      input: async (input: StakingLedgerToVotingLedgerDigestTaskInput) => {
        return JSON.stringify({
          publicInput: StakingLedgerToVotingLedgerProgramInput.toJSON(
            input.publicInput
          ),
          accounts: input.privateInput.accounts.map((account) =>
            Account.toJSON(account)
          ),
          stakingLedgerWitnesses: Object.entries(
            input.stakingLedgerWitnesses
          ).reduce(
            (acc, [key, value]) => {
              acc[key] = value.toJSON();
              return acc;
            },
            {} as Record<string, string>
          ),
          votingAccounts: Object.entries(input.votingAccounts).reduce(
            (acc, [key, value]) => {
              acc[key] = value.map((votingAccount) =>
                VotingAccount.toJSON(votingAccount)
              );
              return acc;
            },
            {} as Record<
              string,
              {
                balance: string;
              }[]
            >
          ),
          votingLedgerWitnesses: Object.entries(
            input.votingLedgerWitnesses
          ).reduce(
            (acc, [key, value]) => {
              acc[key] = value.map((witness) => witness.toJSON());
              return acc;
            },
            {} as Record<string, string[]>
          ),
        });
      },
      output: async (output: StakingLedgerToVotingLedgerDigestTaskOutput) => {
        Provable.log("output", output);
        return JSON.stringify(output.proof.toJSON());
      },
    };
  }

  public get deserializers() {
    return {
      input: async (input: string) => {
        const {
          publicInput,
          accounts,
          stakingLedgerWitnesses,
          votingAccounts,
          votingLedgerWitnesses,
        } = JSON.parse(input);

        return {
          publicInput:
            StakingLedgerToVotingLedgerProgramInput.fromJSON(publicInput),
          privateInput: {
            accounts: accounts.map((account) => Account.fromJSON(account)),
          },
          stakingLedgerWitnesses: Object.entries(stakingLedgerWitnesses).reduce(
            (acc, [key, value]) => {
              acc[key] = PrefixedMerkleWitness36.fromJSON(value);
              return acc;
            },
            {} as Record<string, PrefixedMerkleWitness36>
          ),
          votingAccounts: Object.entries(votingAccounts).reduce(
            (acc, [key, value]) => {
              acc[key] = (value as unknown as { balance: string }[]).map(
                (votingAccount) => VotingAccount.fromJSON(votingAccount as any)
              );
              return acc;
            },
            {} as Record<string, VotingAccount[]>
          ),
          votingLedgerWitnesses: Object.entries(votingLedgerWitnesses).reduce(
            (acc, [key, value]) => {
              acc[key] = (value as unknown as string[]).map((witness) =>
                MerkleWitness256.fromJSON(witness)
              );
              return acc;
            },
            {} as Record<string, MerkleWitness256[]>
          ),
        };
      },
      output: async (output: string) => {
        const proof = JSON.parse(output);
        Provable.log("deserializing output", proof);
        return {
          proof: await StakingLedgerToVotingLedger.Proof.fromJSON(proof),
        };
      },
    };
  }

  public async run(input: StakingLedgerToVotingLedgerDigestTaskInput) {
    console.trace("running task");

    const {
      publicInput,
      privateInput: { accounts },
      stakingLedgerWitnesses,
      votingAccounts,
      votingLedgerWitnesses,
    } = input;

    Provable.log("running task with input", input);

    const stakingLedgerTreeService =
      new PrefilledPrefixedMerkleTree36InMemoryService();
    const votingLedgerTreeService = new PrefilledMerkleTree256InMemoryService();
    const votingAccountService = new PrefilledVotingAccountInMemoryService();

    for (const [index, witness] of Object.entries(stakingLedgerWitnesses)) {
      await stakingLedgerTreeService.setWitness(BigInt(index), witness);
    }

    for (const [key, accounts] of Object.entries(votingAccounts)) {
      await votingAccountService.prefillVotingAccounts(key, accounts);
    }

    for (const [index, witnesses] of Object.entries(votingLedgerWitnesses)) {
      for (const witness of witnesses) {
        await votingLedgerTreeService.setWitness(BigInt(index), witness);
      }
    }

    stakingLedgerToVotingLedgerContext.set({
      stakingLedgerTree: stakingLedgerTreeService,
      votingLedgerTree: votingLedgerTreeService,
      votingAccounts: votingAccountService,
    });

    let result: Awaited<ReturnType<typeof StakingLedgerToVotingLedger.digest>>;
    console.time("digest");
    result = await StakingLedgerToVotingLedger.digest(publicInput, accounts);
    console.timeEnd("digest");

    return result;
  }
}
