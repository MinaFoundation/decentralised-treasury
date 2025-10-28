import _ from "lodash";
import {
  // Account,
  Bool,
  DynamicProof,
  Field,
  MerkleTree,
  MerkleWitness,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Struct,
  // TODO: replace with UInt36 or larger, since the ledger is height 36
  UInt32,
  UInt64,
  ZkProgram,
} from "o1js";
import {
  MerkleTree256Service,
  MerkleWitness256,
  PrefixedMerkleWitness36,
  PrefixedMerkleTree36Service,
  accountLedgerHashPrefixes,
} from "../services/merkle-tree-service.js";
import { ContextProvider } from "../providers/context-provider.js";
import { VotingAccountService } from "../services/voting-account-service.js";
import { Account, accountHashPrefix, packToFields } from "./account.js";
import { hashWithPrefix } from "./hashing-helpers.js";

export interface StakingLedgerToVotingLedgerContext {
  stakingLedgerTree: PrefixedMerkleTree36Service;
  votingLedgerTree: MerkleTree256Service;
  votingAccounts: VotingAccountService;
}

export const stakingLedgerToVotingLedgerContext =
  new ContextProvider<StakingLedgerToVotingLedgerContext>();

export const STAKING_LEDGER_TREE_HEIGHT = 36;
export const VOTING_LEDGER_TREE_HEIGHT = 256;

export const ACCOUNT_BATCH_SIZE = 5;
export const AccountBatch = Provable.Array(Account, ACCOUNT_BATCH_SIZE);

// TODO: could have just been UInt64, but maybe we'll need more information later in the implementation?
export class VotingAccount extends Struct({
  balance: UInt64,
}) {
  // TODO: its not sufficient to create dummies like this, what if the voting account simply has 0 balance?
  public static dummy() {
    return VotingAccount.empty();
  }

  public static isEmpty(votingAccount: VotingAccount) {
    return Poseidon.hash(VotingAccount.toFields(votingAccount)).equals(
      Poseidon.hash(VotingAccount.toFields(VotingAccount.empty()))
    );
  }
}

export class StakingLedgerToVotingLedgerProgramInput extends Struct({
  index: UInt32,
  stakingLedgerRoot: Field,
  // TODO: use 2^32 tree and double check the voting account's witness index against the staking ledger witness index
  votingLedgerRoot: Field, // empty root
  totalCurrency: UInt64,
}) {}

export class StakingLedgerToVotingLedgerProgramOutput extends Struct({
  index: UInt32,
  votingLedgerRoot: Field, // final root
  // votingLedgerST  -> explore an idea of instructions --> aws lambda limits parelelization to 7k instances at a given time per region?
  exhausted: Bool,
  totalCurrency: UInt64,
}) {}

export const emptyVotingAccountLeaf = Field(0);

export interface StakingLedgerToVotingLedgerTrace {
  publicInput: StakingLedgerToVotingLedgerProgramInput;
  privateInput: {
    accounts: Account[];
  };
}

export const StakingLedgerToVotingLedger = ZkProgram({
  name: "staking-ledger-to-voting-ledger",
  publicInput: StakingLedgerToVotingLedgerProgramInput,
  publicOutput: StakingLedgerToVotingLedgerProgramOutput,
  methods: {
    /**
     * Conclude proving by ensuring previousProof.output.index + 1 is empty in the staking ledger
     */
    exhaust: {
      privateInputs: [SelfProof],
      method: async (
        publicInput: StakingLedgerToVotingLedgerProgramInput,
        proof: SelfProof<
          StakingLedgerToVotingLedgerProgramInput,
          StakingLedgerToVotingLedgerProgramOutput
        >
      ) => {
        const context = stakingLedgerToVotingLedgerContext.get();
        proof.verify();

        const input = proof.publicInput;
        const output = proof.publicOutput;

        // ensure current public input matches the public input of the proof
        Poseidon.hash(
          StakingLedgerToVotingLedgerProgramInput.toFields(publicInput)
        ).assertEquals(
          Poseidon.hash(StakingLedgerToVotingLedgerProgramInput.toFields(input))
        );

        // ensure the next index is empty in the staking ledger
        const nextIndex = output.index.add(1);

        // check the next index is empty in the staking ledger
        let witness = await Provable.witnessAsync(
          PrefixedMerkleWitness36,
          async () => {
            return await context.stakingLedgerTree.getWitness(
              BigInt(nextIndex.toBigint())
            );
          }
        );

        const emptyAccount = Account.empty();
        const emptyAccountLeaf = hashWithPrefix(
          accountHashPrefix,
          packToFields(Account.toHashInput(emptyAccount))
        );

        const calculatedIndex = witness.calculateIndex();
        // TODO: use whatever the empty value is in the staking ledger tree
        const calculatedRoot = witness.calculateRoot(
          emptyAccountLeaf,
          accountLedgerHashPrefixes
        );

        // assert that the empty placeholder we're working with is indeed part of the staking ledger
        calculatedRoot.assertEquals(input.stakingLedgerRoot);
        calculatedIndex.assertEquals(nextIndex.toFields()[0]);

        return {
          publicOutput: {
            ...output,
            exhausted: Bool(true),
          },
        };
      },
    },
    /**
     * Merge two adjacent digest proofs into a single proof
     */
    merge: {
      privateInputs: [SelfProof, SelfProof],
      method: async (
        publicInput: StakingLedgerToVotingLedgerProgramInput,
        proof1: SelfProof<
          StakingLedgerToVotingLedgerProgramInput,
          StakingLedgerToVotingLedgerProgramOutput
        >,
        proof2: SelfProof<
          StakingLedgerToVotingLedgerProgramInput,
          StakingLedgerToVotingLedgerProgramOutput
        >
      ) => {
        let { index, stakingLedgerRoot, votingLedgerRoot, totalCurrency } =
          publicInput;

        proof1.verify();
        proof2.verify();

        const input1 = proof1.publicInput;
        const output1 = proof1.publicOutput;
        const input2 = proof2.publicInput;
        const output2 = proof2.publicOutput;

        Poseidon.hash(
          StakingLedgerToVotingLedgerProgramInput.toFields(publicInput)
        ).assertEquals(
          Poseidon.hash(
            StakingLedgerToVotingLedgerProgramInput.toFields(input1)
          )
        );

        input1.stakingLedgerRoot.assertEquals(input1.stakingLedgerRoot);
        output1.index.add(1).assertEquals(input2.index);
        output1.votingLedgerRoot.assertEquals(input2.votingLedgerRoot);
        output1.totalCurrency.assertEquals(input2.totalCurrency);

        return {
          publicOutput: {
            index: output2.index,
            votingLedgerRoot: output2.votingLedgerRoot,
            totalCurrency: output2.totalCurrency,
            exhausted: Bool(false),
          },
        };
      },
    },
    /**
     * Prove transformation of a subset of the staking ledger into a rolling version of the voting ledger
     */
    digest: {
      // TODO: accounts could come served via a witness from a service / dependency
      privateInputs: [Provable.Array(Account, ACCOUNT_BATCH_SIZE)],
      method: async (
        publicInput: StakingLedgerToVotingLedgerProgramInput,
        accounts: Account[]
      ) => {
        const context = stakingLedgerToVotingLedgerContext.get();
        let { index, stakingLedgerRoot, votingLedgerRoot, totalCurrency } =
          publicInput;

        for (let i = 0; i < ACCOUNT_BATCH_SIZE; i++) {
          const account = accounts[i];

          // TODO: handle cases where the index points to an empty account / dummy account
          // check if account is in the staking ledger
          let accountWitness = await Provable.witnessAsync(
            PrefixedMerkleWitness36,
            async () => {
              return await context.stakingLedgerTree.getWitness(
                index.toBigint()
              );
            }
          );

          const emptyAccount = Account.empty();
          const emptyAccountLeaf = hashWithPrefix(
            accountHashPrefix,
            packToFields(Account.toHashInput(emptyAccount))
          );

          const accountLeaf = hashWithPrefix(
            accountHashPrefix,
            packToFields(Account.toHashInput(account))
          );

          const calculatedStakingLedgerIndex = accountWitness.calculateIndex();
          const calculatedStakingLedgerRoot = accountWitness.calculateRoot(
            accountLeaf,
            accountLedgerHashPrefixes
          );
          const calculatedEmptyStakingLedgerRoot = accountWitness.calculateRoot(
            emptyAccountLeaf,
            accountLedgerHashPrefixes
          );

          // assert that we're working with an account at the correct index
          calculatedStakingLedgerIndex.assertEquals(
            index.toFields()[0],
            "staking ledger tree account index not matching"
          );

          Provable.log("debug", {
            index,
            account,
            calculatedStakingLedgerIndex,
            calculatedStakingLedgerRoot,
            calculatedEmptyStakingLedgerRoot,
            stakingLedgerRoot,
          });

          // assert that the account we're working with is indeed part of the staking ledger
          calculatedStakingLedgerRoot
            .equals(stakingLedgerRoot)
            // TODO: don't think we need isEmpty checks anymore since real ledger empty entry is an actual empty account not Field(0)
            // if the account is a dummy, we check the root against a root calculated with an empty account placeholder
            .or(
              Account.isEmpty(account).and(
                calculatedEmptyStakingLedgerRoot.equals(stakingLedgerRoot)
              )
            )
            .assertTrue("staking ledger tree account root not matching");

          // TODO: fix the logic for determining if its a token account, once we start using the real account struct
          // token accounts have empty delegates, other accounts have either self address or a real delegate address
          const delegateAddress = account.delegate; // TODO: why is this optional in TS?
          // const isMinaAccount = delegateAddress.equals(PublicKey.empty()).not();

          // load the voting account associated with the delegate address and ensure its valid given the voting ledger root
          const votingAccount = await Provable.witnessAsync(
            VotingAccount,
            async () => {
              return await stakingLedgerToVotingLedgerContext
                .get()
                .votingAccounts.getVotingAccount(delegateAddress.toBase58());
            }
          );

          const votingAccountHash = Poseidon.hash(
            VotingAccount.toFields(votingAccount)
          );

          // load delegate account and check its inclusion in the voting ledger
          const votingAccountWitness = await Provable.witnessAsync(
            MerkleWitness256,
            async () => {
              return await stakingLedgerToVotingLedgerContext
                .get()
                .votingLedgerTree.getWitness(
                  Poseidon.hash(delegateAddress.toFields()).toBigInt()
                );
            }
          );

          const calculatedVotingAccountIndex =
            votingAccountWitness.calculateIndex();
          const calculatedVotingLedgerRoot =
            votingAccountWitness.calculateRoot(votingAccountHash);
          const calculatedEmptyVotingLedgerRoot =
            votingAccountWitness.calculateRoot(emptyVotingAccountLeaf);

          calculatedVotingAccountIndex.assertEquals(
            Poseidon.hash(delegateAddress.toFields()),
            "voting ledger witness index not matching"
          );

          Provable.log("debug", {
            index,
            pk: account.pk,
            balance: account.balance,
            delegateAddress,
            votingAccount,
            calculatedVotingLedgerRoot,
            votingLedgerRoot,
            calculatedEmptyVotingLedgerRoot,
          });

          // assert that the account we're working with is indeed part of the voting ledger
          calculatedVotingLedgerRoot
            .equals(votingLedgerRoot)
            // or if the voting ledger entry is empty, ensure that a dummy account is used
            .or(
              VotingAccount.isEmpty(votingAccount).and(
                calculatedEmptyVotingLedgerRoot.equals(votingLedgerRoot)
              )
            )
            .assertTrue("voting ledger root does not match");

          // !!! TODO: balance contains unvested tokens, need to subtract the vested amount
          totalCurrency = totalCurrency.add(account.balance);
          // append updated delegate account to the new voting weight ledger
          votingAccount.balance = votingAccount.balance.add(account.balance);
          const updatedVotingAccountHash = Poseidon.hash(
            VotingAccount.toFields(votingAccount)
          );

          votingLedgerRoot = votingAccountWitness.calculateRoot(
            updatedVotingAccountHash
          );

          // update the voting account in the voting accounts record
          await Provable.witnessAsync(Field, async () => {
            context.votingAccounts.setVotingAccount(
              delegateAddress.toBase58(),
              votingAccount
            );
            context.votingLedgerTree.setLeaf(
              Poseidon.hash(delegateAddress.toFields()).toBigInt(),
              Poseidon.hash(VotingAccount.toFields(votingAccount))
            );
            return Field(0);
          });

          // TODO: should we be incrementing the index even if the account is a dummy?
          // how does this affect the exhaust proof?

          // we've started at the input index, and with each iteration we move to the next account
          index = index.add(1);
        }

        return {
          publicOutput: {
            // since we incremented index at the end of the loop, we need to subtract 1 to get the actual index
            index: index.sub(1),
            exhausted: Bool(false),
            votingLedgerRoot,
            totalCurrency,
          },
        };
      },
    },
  },
});

export class SideLoadedStakingLedgerToVotingLedgerProof extends DynamicProof<
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput
> {
  static publicInputType = StakingLedgerToVotingLedgerProgramInput;
  static publicOutputType = StakingLedgerToVotingLedgerProgramOutput;
  static maxProofsVerified = 0 as const;
}
