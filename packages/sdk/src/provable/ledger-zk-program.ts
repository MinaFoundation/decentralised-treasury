import _ from "lodash";
import {
  // Account,
  Bool,
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

// TODO: replace this class with the real o1js Account, once i figure out how to witness it
export class Account extends Struct({
  publicKey: PublicKey,
  delegate: PublicKey,
  balance: UInt64,
}) {}

export const LEDGER_TREE_HEIGHT = 32;
export const VOTING_TREE_HEIGHT = LEDGER_TREE_HEIGHT;
export let stakingLedgerTree = new MerkleTree(LEDGER_TREE_HEIGHT);
export let votingLedgerTree = new MerkleTree(VOTING_TREE_HEIGHT);

export class MerkleWitness32 extends MerkleWitness(32) {}

export const ACCOUNT_BATCH_SIZE = 25;
export const AccountBatch = Provable.Array(Account, ACCOUNT_BATCH_SIZE);

// TODO: could have just been UInt64, but maybe we'll need more information later in the implementation?
export class VotingAccount extends Struct({
  balance: UInt64,
}) {}

export let accounts: Record<string, Account | undefined> = {};

export let votingAccounts: Record<string, VotingAccount | undefined> = {};

export class ProgramInput extends Struct({
  index: UInt32,
  stakingLedgerRoot: Field,
  // TODO: use 2^32 tree and double check the voting account's witness index against the staking ledger witness index
  votingLedgerRoot: Field, // empty root
}) {}

export class ProgramOutput extends Struct({
  index: UInt32,
  votingLedgerRoot: Field, // final root
  // votingLedgerST  -> explore an idea of instructions --> aws lambda limits parelelization to 7k instances at a given time per region?
  exhausted: Bool,
}) {}

export async function getAccountByIndex(index: string) {
  return accounts[index.toString()] ?? Account.empty();
}

export async function getAccountByAddress(address: string) {
  const account = _.find(
    accounts,
    (account) => account.publicKey.toBase58() === address
  );
  return account;
}

export async function getAccountIndexByAddress(address: string) {
  return _.findKey(
    accounts,
    (account) => account.publicKey.toBase58() === address
  );
}

export async function assertAccountIsInStakingLedger(
  account: Account,
  index: UInt32,
  stakingLedgerRoot: Field
) {
  // check if account is in the staking ledger
  let witness = await Provable.witnessAsync(MerkleWitness32, async () => {
    return new MerkleWitness32(stakingLedgerTree.getWitness(index.toBigint()));
  });

  const accountHash = Poseidon.hash(Account.toFields(account));

  const calculatedIndex = witness.calculateIndex();
  const calculatedRoot = witness.calculateRoot(accountHash);

  const indexField = index.toFields()[0];

  // assert that we're working with an account at the correct index
  calculatedIndex.assertEquals(indexField);
  // assert that the account we're working with is indeed part of the staking ledger
  calculatedRoot.assertEquals(stakingLedgerRoot);
}

// !!! TODO: we can't reuse the staking ledger index in the voting ledger because the delegate can be any public key that does not exist in the staking ledger yet
// TODO: name could be better so signify the underlying assertion?
export async function calculateAccountIndexInStakingLedger(
  account: Account,
  stakingLedgerRoot: Field
) {
  // check if account is in the staking ledger
  let witness = await Provable.witnessAsync(MerkleWitness32, async () => {
    const index = await getAccountIndexByAddress(account.publicKey.toBase58());
    return new MerkleWitness32(stakingLedgerTree.getWitness(BigInt(index)));
  });

  const accountHash = Poseidon.hash(Account.toFields(account));

  const calculatedIndex = witness.calculateIndex();
  const calculatedRoot = witness.calculateRoot(accountHash);

  // assert that the account we're working with is indeed part of the staking ledger
  calculatedRoot.assertEquals(stakingLedgerRoot);

  return calculatedIndex;
}

export async function getVotingAccountByIndex(index: string) {
  return votingAccounts[index.toString()] ?? VotingAccount.empty();
}

export async function assertAccountIsInVotingLedger(
  votingAccount: VotingAccount,
  index: UInt32,
  votingLedgerRoot: Field
) {
  const votingAccountHash = Poseidon.hash(
    VotingAccount.toFields(votingAccount)
  );

  // load delegate account and check its inclusion in the voting ledger
  const votingAccountWitness = await Provable.witnessAsync(
    MerkleWitness32,
    async () => {
      return new MerkleWitness32(votingLedgerTree.getWitness(index.toBigint()));
    }
  );

  const calculatedVotingAccountIndex = votingAccountWitness.calculateIndex();
  const calculatedVotingLedgerRoot =
    votingAccountWitness.calculateRoot(votingAccountHash);
  const calculatedEmptyVotingLedgerRoot = votingAccountWitness.calculateRoot(
    Field(0)
  );

  const indexField = index.toFields()[0];
  calculatedVotingAccountIndex.assertEquals(
    indexField,
    "voting ledger witness index not matching"
  );

  // assert that the account we're working with is indeed part of the voting ledger
  calculatedVotingLedgerRoot
    .equals(votingLedgerRoot)
    // or if the voting ledger entry is empty, ensure that a dummy account is used
    .or(
      calculatedEmptyVotingLedgerRoot
        .equals(votingLedgerRoot)
        .and(
          Poseidon.hash(VotingAccount.toFields(votingAccount)).equals(
            Poseidon.hash(VotingAccount.toFields(VotingAccount.empty()))
          )
        )
    )
    .assertTrue();
}

export async function upsertAccountInVotingLedger(
  votingAccount: VotingAccount,
  index: UInt32
) {
  const votingAccountHash = Poseidon.hash(
    VotingAccount.toFields(votingAccount)
  );

  // load delegate account and check its inclusion in the voting ledger
  const votingAccountWitness = await Provable.witnessAsync(
    MerkleWitness32,
    async () => {
      return new MerkleWitness32(votingLedgerTree.getWitness(index.toBigint()));
    }
  );

  const calculatedVotingAccountIndex = votingAccountWitness.calculateIndex();
  const calculatedVotingLedgerRoot =
    votingAccountWitness.calculateRoot(votingAccountHash);

  const indexField = index.toFields()[0];
  calculatedVotingAccountIndex.assertEquals(indexField);

  // TODO: obviously this needs an elaborate service structure later on
  // update the voting account in the voting accounts record
  await Provable.witnessAsync(Field, async () => {
    await upsertVotingAccount(votingAccount, index);
    return Field(0);
  });

  return calculatedVotingLedgerRoot;
}

export async function upsertVotingAccount(
  votingAccount: VotingAccount,
  index: UInt32
) {
  votingAccounts[index.toString()] = votingAccount;
  votingLedgerTree.setLeaf(
    index.toBigint(),
    Poseidon.hash(VotingAccount.toFields(votingAccount))
  );
}

export async function checkIndexIsEmptyInStakingLedger(
  index: UInt32,
  stakingLedgerRoot: Field
) {
  // check if account is in the staking ledger
  let witness = await Provable.witnessAsync(MerkleWitness32, async () => {
    return new MerkleWitness32(
      stakingLedgerTree.getWitness(BigInt(index.toBigint()))
    );
  });

  const emptyAccountPlaceholder = Field(0);
  const calculatedIndex = witness.calculateIndex();
  // TODO: use whatever the empty value is in the staking ledger tree
  const calculatedRoot = witness.calculateRoot(emptyAccountPlaceholder);

  // assert that the placeholder we're working with is indeed part of the staking ledger
  calculatedRoot.assertEquals(stakingLedgerRoot);

  return calculatedIndex;
}

export const ledgerZkProgram = ZkProgram({
  name: "ledger-zk-program",
  publicInput: ProgramInput,
  publicOutput: ProgramOutput,
  methods: {
    exhaust: {
      privateInputs: [SelfProof],
      method: async (
        publicInput: ProgramInput,
        proof: SelfProof<ProgramInput, ProgramOutput>
      ) => {
        proof.verify();

        const input = proof.publicInput;
        const output = proof.publicOutput;

        Poseidon.hash(ProgramInput.toFields(publicInput)).assertEquals(
          Poseidon.hash(ProgramInput.toFields(input))
        );

        const nextIndex = output.index.add(1);
        await checkIndexIsEmptyInStakingLedger(
          nextIndex,
          input.stakingLedgerRoot
        );

        return {
          publicOutput: {
            ...output,
            exhausted: Bool(true),
          },
        };
      },
    },
    merge: {
      privateInputs: [SelfProof, SelfProof],
      method: async (
        publicInput: ProgramInput,
        proof1: SelfProof<ProgramInput, ProgramOutput>,
        proof2: SelfProof<ProgramInput, ProgramOutput>
      ) => {
        let { index, stakingLedgerRoot, votingLedgerRoot } = publicInput;

        proof1.verify();
        proof2.verify();

        const input1 = proof1.publicInput;
        const output1 = proof1.publicOutput;
        const input2 = proof2.publicInput;
        const output2 = proof2.publicOutput;

        Poseidon.hash(ProgramInput.toFields(publicInput)).assertEquals(
          Poseidon.hash(ProgramInput.toFields(input1))
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
    digest: {
      // TODO: accounts could come served via a witness from a service / dependency
      privateInputs: [],
      method: async (publicInput: ProgramInput) => {
        let { index, stakingLedgerRoot, votingLedgerRoot } = publicInput;

        for (let i = 0; i < ACCOUNT_BATCH_SIZE; i++) {
          const account = await Provable.witnessAsync(Account, async () => {
            return await getAccountByIndex(index.toString());
          });

          // TODO: handle cases where the index points to an empty account
          await assertAccountIsInStakingLedger(
            account,
            index,
            stakingLedgerRoot
          );

          // token accounts have empty delegates, other accounts have either self address or a real delegate address
          const delegateAddress = account.delegate; // TODO: why is this optional in TS?
          // const isMinaAccount = delegateAddress.equals(PublicKey.empty()).not();

          const delegateAccount = await Provable.witnessAsync(
            Account,
            async () => {
              return await getAccountByAddress(delegateAddress.toBase58());
            }
          );

          // (!!!) TODO: this approach with reusing the existing account index only works if the account is already in the staking ledger
          // if its possible to delegate to a new account that is not in the staking ledger, then we'll need to revert back to a 256 height tree
          // for the voting ledger
          const delegateAccountIndex =
            await calculateAccountIndexInStakingLedger(
              delegateAccount,
              stakingLedgerRoot
            );

          const votingAccount = await Provable.witnessAsync(
            VotingAccount,
            async () => {
              return await getVotingAccountByIndex(
                delegateAccountIndex.toString()
              );
            }
          );

          await assertAccountIsInVotingLedger(
            votingAccount,
            UInt32.fromFields(delegateAccountIndex.toFields()),
            votingLedgerRoot
          );

          // !!! TODO: balance contains unvested tokens, need to subtract the vested amount
          // append updated delegate account to the new voting weight ledger
          votingAccount.balance = votingAccount.balance.add(account.balance);
          votingLedgerRoot = await upsertAccountInVotingLedger(
            votingAccount,
            UInt32.fromFields(delegateAccountIndex.toFields())
          );

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
