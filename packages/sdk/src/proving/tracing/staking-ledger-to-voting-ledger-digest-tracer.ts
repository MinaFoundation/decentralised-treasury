import {
  ACCOUNT_BATCH_SIZE,
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  VotingAccount,
} from "../../provable/staking-ledger-to-voting-ledger.js";
import {
  Account,
  accountHashPrefix,
  packToFields,
} from "../../provable/account.js";
import {
  MerkleTree256InMemoryService,
  MerkleWitness256,
  PrefixedMerkleTree36InMemoryService,
  PrefixedMerkleWitness36,
} from "../../services/merkle-tree-service.js";
import { VotingAccountInMemoryService } from "../../services/voting-account-service.js";
import { hashWithPrefix } from "../../provable/hashing-helpers.js";
import { Provable, UInt32, UInt64 } from "o1js";
import { Capturable } from "../../providers/context-provider.js";

export interface StakingLedgerToVotingLedgerDigestTrace {
  publicInput: StakingLedgerToVotingLedgerProgramInput;
  privateInput: {
    accounts: Account[];
  };
  stakingLedgerWitnesses: Record<string, PrefixedMerkleWitness36>;
  votingAccounts: Record<string, VotingAccount[]>;
  votingLedgerWitnesses: Record<string, MerkleWitness256[]>;
}

export class StakingLedgerToVotingLedgerDigestTracer {
  public static async trace(accounts: Account[]) {
    const iterations = Math.ceil(accounts.length / ACCOUNT_BATCH_SIZE);
    const stakingLedgerTreeService = new PrefixedMerkleTree36InMemoryService();
    const votingLedgerTreeService = new MerkleTree256InMemoryService();
    const votingAccountService = new VotingAccountInMemoryService();

    stakingLedgerToVotingLedgerContext.set({
      stakingLedgerTree: stakingLedgerTreeService,
      votingLedgerTree: votingLedgerTreeService,
      votingAccounts: votingAccountService,
    });

    // build the staking ledger tree
    accounts.forEach((account, index) => {
      stakingLedgerTreeService.setLeaf(
        BigInt(index),
        hashWithPrefix(
          accountHashPrefix,
          packToFields(Account.toHashInput(account))
        )
      );
    });

    Provable.log("root hash", stakingLedgerTreeService.tree.getRoot());

    let traces: StakingLedgerToVotingLedgerDigestTrace[] = [];

    let publicOutput: StakingLedgerToVotingLedgerProgramOutput;
    for (let i = 0; i < iterations; i++) {
      // take a slice of the accounts for the current iteration (batch)
      let accountsSlice = accounts.slice(
        i * ACCOUNT_BATCH_SIZE,
        (i + 1) * ACCOUNT_BATCH_SIZE
      );

      // TODO: this can be done outside of the loop just once
      // if the slice is not the full batch size, add empty accounts to satisfy the batch size
      if (accountsSlice.length !== ACCOUNT_BATCH_SIZE) {
        const missingAccounts = ACCOUNT_BATCH_SIZE - accountsSlice.length;
        console.log(
          `adding ${missingAccounts} extra empty accounts to satisfy batch size`
        );
        for (let j = 0; j < missingAccounts; j++) {
          accountsSlice.push(Account.empty());
        }
      }

      Provable.log("acocunts slice", accountsSlice.length, accountsSlice);

      const publicInput: StakingLedgerToVotingLedgerProgramInput = {
        index: UInt32.from(i * ACCOUNT_BATCH_SIZE),
        stakingLedgerRoot: stakingLedgerTreeService.tree.getRoot(),
        votingLedgerRoot: votingLedgerTreeService.tree.getRoot(),
        totalCurrency: publicOutput?.totalCurrency ?? UInt64.from(0),
      };

      console.log("tracing iteration", i, "/ ", iterations);

      stakingLedgerToVotingLedgerContext.startCapture();

      let { publicOutput: currentPublicOutput } =
        await StakingLedgerToVotingLedger.rawMethods.digest(
          publicInput,
          accountsSlice
        );

      publicOutput = currentPublicOutput;

      const { captured: stakingLedgerWitnesses } =
        stakingLedgerToVotingLedgerContext.context
          .stakingLedgerTree as unknown as Capturable<
          Record<string, PrefixedMerkleWitness36>
        >;
      const { captured: votingLedgerWitnesses } =
        stakingLedgerToVotingLedgerContext.context
          .votingLedgerTree as unknown as Capturable<
          Record<string, MerkleWitness256[]>
        >;
      const { captured: votingAccounts } = stakingLedgerToVotingLedgerContext
        .context.votingAccounts as unknown as Capturable<
        Record<string, VotingAccount[]>
      >;

      traces.push({
        publicInput,
        privateInput: {
          accounts: accountsSlice,
        },
        stakingLedgerWitnesses,
        votingLedgerWitnesses,
        votingAccounts,
      });
    }

    return traces;
  }
}
