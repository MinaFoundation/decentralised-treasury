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
  UInt32,
  UInt64,
  ZkProgram,
} from "o1js";
import {
  MerkleTree256Service,
  MerkleWitness256,
  MerkleWitness32,
  MerkleTree32Service,
} from "../services/merkle-tree-service.js";
import { ContextProvider } from "../providers/context-provider.js";
import { VotingAccountService } from "../services/voting-account-service.js";

export interface StakingLedgerToVotingLedgerContext {
  stakingLedgerTree: MerkleTree32Service;
  votingLedgerTree: MerkleTree256Service;
  votingAccounts: VotingAccountService;
}

export const stakingLedgerToVotingLedgerContext =
  new ContextProvider<StakingLedgerToVotingLedgerContext>();

// TODO: replace this class with the real o1js Account, once i figure out how to witness it
export class Account extends Struct({
  publicKey: PublicKey,
  delegate: PublicKey,
  balance: UInt64,
}) {
  public static dummy() {
    return Account.empty();
  }

  public static isDummy(account: Account) {
    return Poseidon.hash(Account.toFields(account)).equals(
      Poseidon.hash(Account.toFields(Account.empty()))
    );
  }
}

export const STAKING_LEDGER_TREE_HEIGHT = 32;
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

  public static isDummy(votingAccount: VotingAccount) {
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
}) {}

export class StakingLedgerToVotingLedgerProgramOutput extends Struct({
  index: UInt32,
  votingLedgerRoot: Field, // final root
  // votingLedgerST  -> explore an idea of instructions --> aws lambda limits parelelization to 7k instances at a given time per region?
  exhausted: Bool,
}) {}

export const emptyAccountPlaceholder = Field(0);

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
        let witness = await Provable.witnessAsync(MerkleWitness32, async () => {
          return await context.stakingLedgerTree.getWitness(
            BigInt(nextIndex.toBigint())
          );
        });

        const calculatedIndex = witness.calculateIndex();
        // TODO: use whatever the empty value is in the staking ledger tree
        const calculatedRoot = witness.calculateRoot(emptyAccountPlaceholder);

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
     * Merge two adjacent digestproofs into a single proof
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
        let { index, stakingLedgerRoot, votingLedgerRoot } = publicInput;

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

        return {
          publicOutput: {
            index: output2.index,
            votingLedgerRoot: output2.votingLedgerRoot,
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
        let { index, stakingLedgerRoot, votingLedgerRoot } = publicInput;

        for (let i = 0; i < ACCOUNT_BATCH_SIZE; i++) {
          const account = accounts[i];

          // TODO: handle cases where the index points to an empty account / dummy account
          // check if account is in the staking ledger
          let accountWitness = await Provable.witnessAsync(
            MerkleWitness32,
            async () => {
              return await context.stakingLedgerTree.getWitness(
                index.toBigint()
              );
            }
          );

          const accountHash = Poseidon.hash(Account.toFields(account));

          const calculatedStakingLedgerIndex = accountWitness.calculateIndex();
          const calculatedStakingLedgerRoot =
            accountWitness.calculateRoot(accountHash);
          const calculatedEmptyStakingLedgerRoot = accountWitness.calculateRoot(
            emptyAccountPlaceholder
          );

          // assert that we're working with an account at the correct index
          calculatedStakingLedgerIndex.assertEquals(
            index.toFields()[0],
            "staking ledger tree account index not matching"
          );

          // assert that the account we're working with is indeed part of the staking ledger
          calculatedStakingLedgerRoot
            .equals(stakingLedgerRoot)
            // if the account is a dummy, we check the root against a root calculated with an empty account placeholder
            .or(
              Account.isDummy(account).and(
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
            votingAccountWitness.calculateRoot(emptyAccountPlaceholder);

          calculatedVotingAccountIndex.assertEquals(
            Poseidon.hash(delegateAddress.toFields()),
            "voting ledger witness index not matching"
          );

          // assert that the account we're working with is indeed part of the voting ledger
          calculatedVotingLedgerRoot
            .equals(votingLedgerRoot)
            // or if the voting ledger entry is empty, ensure that a dummy account is used
            .or(
              VotingAccount.isDummy(votingAccount).and(
                calculatedEmptyVotingLedgerRoot.equals(votingLedgerRoot)
              )
            )
            .assertTrue("voting ledger root does not match");

          // !!! TODO: balance contains unvested tokens, need to subtract the vested amount
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

          // we've started at the input index, and with each iteration we move to the next account
          index = index.add(1);
        }

        return {
          publicOutput: {
            // since we incremented index at the end of the loop, we need to subtract 1 to get the actual index
            index: index.sub(1),
            exhausted: Bool(false),
            votingLedgerRoot,
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
