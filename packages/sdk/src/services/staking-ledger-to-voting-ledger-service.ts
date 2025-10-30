import { hashWithPrefix } from "../provable/hashing-helpers.js";
import {
  Account,
  accountHashPrefix,
  packToFields,
} from "../provable/account.js";
import { readLedger } from "../read-ledger.js";
import {
  MerkleTree256InMemoryService,
  PrefixedMerkleTree36InMemoryService,
  PrefixedMerkleTree36Service,
} from "./merkle-tree-service.js";
import { VotingAccountInMemoryService } from "./voting-account-service.js";
import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../provable/staking-ledger-to-voting-ledger.js";
import { Bool, Proof, Provable, UInt32, UInt64 } from "o1js";

export class StakingLedgerToVotingLedgerService {
  public stakingLedgerTreeService = new PrefixedMerkleTree36InMemoryService();
  public votingLedgerTreeService = new MerkleTree256InMemoryService();
  public votingAccountService = new VotingAccountInMemoryService();

  public async readLedger(path: string): Promise<Account[]> {
    return readLedger(path);
  }

  public async populateStakingLedgerTree(accounts: Account[]) {
    console.time("populateStakingLedgerTree");
    console.log(
      "populating staking ledger tree with",
      accounts.length,
      "accounts"
    );
    for (const account of accounts) {
      this.stakingLedgerTreeService.setLeaf(
        BigInt(accounts.indexOf(account)),
        hashWithPrefix(
          accountHashPrefix,
          packToFields(Account.toHashInput(account))
        )
      );
    }
    console.timeEnd("populateStakingLedgerTree");
  }

  public async compile() {
    console.time("compile StakingLedgerToVotingLedger");
    console.log("compiling StakingLedgerToVotingLedger");
    // TODO: should be empty services just in case?
    stakingLedgerToVotingLedgerContext.set({
      stakingLedgerTree: this.stakingLedgerTreeService,
      votingLedgerTree: this.votingLedgerTreeService,
      votingAccounts: this.votingAccountService,
    });
    await StakingLedgerToVotingLedger.compile({
      proofsEnabled: process.env.PROOFS_ENABLED === "true",
    });
    console.timeEnd("compile StakingLedgerToVotingLedger");
  }

  // TODO: transition to using the task queue
  public async digest(
    accounts: Account[]
  ): Promise<
    Proof<
      StakingLedgerToVotingLedgerProgramInput,
      StakingLedgerToVotingLedgerProgramOutput
    >
  > {
    console.time("digest");
    console.log("digesting", accounts.length, "accounts");
    const iterations = Math.ceil(accounts.length / ACCOUNT_BATCH_SIZE);
    const missingAccounts =
      ACCOUNT_BATCH_SIZE - (accounts.length % ACCOUNT_BATCH_SIZE);

    if (missingAccounts < ACCOUNT_BATCH_SIZE) {
      console.log(
        `adding ${missingAccounts} extra empty accounts to satisfy batch size`
      );
      for (let i = 0; i < missingAccounts; i++) {
        accounts.push(Account.empty());
      }
    }

    let publicOutput: StakingLedgerToVotingLedgerProgramOutput;
    const proofs: Proof<
      StakingLedgerToVotingLedgerProgramInput,
      StakingLedgerToVotingLedgerProgramOutput
    >[] = [];

    for (let i = 0; i < iterations; i++) {
      console.time(`digest ${i}`);
      const accountsSlice = accounts.slice(
        i * ACCOUNT_BATCH_SIZE,
        (i + 1) * ACCOUNT_BATCH_SIZE
      );

      const publicInput: StakingLedgerToVotingLedgerProgramInput = {
        index: UInt32.from(i * ACCOUNT_BATCH_SIZE),
        stakingLedgerRoot: this.stakingLedgerTreeService.tree.getRoot(),
        votingLedgerRoot: this.votingLedgerTreeService.tree.getRoot(),
        totalCurrency: publicOutput?.totalCurrency ?? UInt64.from(0),
      };

      console.log("digesting slice", i + 1, "of", iterations);

      const { proof } = await StakingLedgerToVotingLedger.digest(
        publicInput,
        accountsSlice
      );
      publicOutput = proof.publicOutput;

      proofs.push(proof);
      console.timeEnd(`digest ${i}`);
    }

    // TODO: remove this mock merging logic
    const firstProof = proofs.sort((a, b) =>
      Number(a.publicInput.index.toBigint() - b.publicInput.index.toBigint())
    )[0];

    const lastProof = proofs.sort((a, b) =>
      Number(b.publicInput.index.toBigint() - a.publicInput.index.toBigint())
    )[0];

    Provable.log("first and last proofs", {
      firstProof: {
        publicInput: firstProof.publicInput,
        publicOutput: firstProof.publicOutput,
      },
      lastProof: {
        publicInput: lastProof.publicInput,
        publicOutput: lastProof.publicOutput,
      },
    });

    console.timeEnd("digest");

    console.time("merge");
    const dummyMergeProof = await StakingLedgerToVotingLedger.Proof.dummy(
      firstProof.publicInput,
      {
        ...firstProof.publicOutput,
        exhausted: Bool(false),
      },
      0
    );

    console.timeEnd("merge");

    return dummyMergeProof;
  }
}
