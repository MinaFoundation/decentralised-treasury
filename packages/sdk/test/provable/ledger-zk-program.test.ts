import { it } from "node:test";
import assert from "node:assert";
import { ocamlToGraphQL } from "../../src/mappers/account-mapper";
import { createTestAccounts } from "../../src/create-test-accounts";
import {
  // Account,
  Field,
  MerkleTree,
  UInt32,
  UInt64,
  Poseidon,
  parseFetchedAccount,
  Provable,
  Proof,
} from "o1js";
import {
  Account,
  ACCOUNT_BATCH_SIZE,
  accounts,
  ledgerZkProgram,
  MerkleWitness32,
  ProgramInput,
  ProgramOutput,
  stakingLedgerTree,
  VOTING_TREE_HEIGHT,
  VotingAccount,
  votingLedgerTree,
} from "../../src/provable/ledger-zk-program";
import _, { orderBy } from "lodash";

export const proofsEnabled = process.env.PROOFS_ENABLED === "true";

let proofs: Proof<ProgramInput, ProgramOutput>[] = [];
let testVotingLedgerTree = new MerkleTree(VOTING_TREE_HEIGHT);

it("should compile the program", async () => {
  await ledgerZkProgram.compile({
    proofsEnabled,
  });
});

it("should analyze the program", async () => {
  const analysis = await ledgerZkProgram.analyzeMethods();
  Provable.log("analysis", analysis);
});

export const TEST_ITERATIONS = 10;

it("should digest a range of indexes", async () => {
  const testAccounts = (
    await createTestAccounts(ACCOUNT_BATCH_SIZE * TEST_ITERATIONS)
  ).map((account) => {
    const parsedAccount = parseFetchedAccount(ocamlToGraphQL(account));
    return {
      publicKey: parsedAccount.publicKey,
      // delegate: parsedAccount.delegate ?? parsedAccount.publicKey,
      delegate: parsedAccount.publicKey,
      balance: parsedAccount.balance,
    };
  });

  // populate circuit consumable variables
  testAccounts.forEach((account, index) => {
    account = {
      ...Account.empty(),
      publicKey: account.publicKey,
      delegate: account.delegate,
      balance: account.balance,
    };
    stakingLedgerTree.setLeaf(
      BigInt(index),
      Poseidon.hash(Account.toFields(account))
    );

    accounts[index.toString()] = account;

    testVotingLedgerTree.setLeaf(
      BigInt(index),
      Poseidon.hash(
        VotingAccount.toFields(
          new VotingAccount({
            balance: account.balance,
          })
        )
      )
    );
  });

  console.log(
    "digesting total of",
    TEST_ITERATIONS * ACCOUNT_BATCH_SIZE,
    "accounts"
  );
  for (let i = 0; i < TEST_ITERATIONS; i++) {
    const input = {
      index: UInt32.from(i * ACCOUNT_BATCH_SIZE),
      totalCurrency: UInt64.from(0),
      stakingLedgerRoot: stakingLedgerTree.getRoot(),
      votingLedgerRoot: votingLedgerTree.getRoot(),
    };

    console.time(`digest ${i}`);
    const { proof } = await ledgerZkProgram.digest(input);
    console.timeEnd(`digest ${i}`);
    Provable.log("proof", i, proof.publicInput, proof.publicOutput);

    const proofSize = new TextEncoder().encode(
      JSON.stringify(proof.toJSON())
    ).length;

    console.log("digest proof size", proofSize);
    proofs.push(proof);
  }

  while (proofs.length > 1) {
    proofs = _.orderBy(proofs, "publicInput.index", "asc");
    let proof1 = proofs[0];
    let proof2 = _.find(proofs, (proof) =>
      proof.publicInput.index
        .equals(proof1.publicOutput.index.add(1))
        .toBoolean()
    );

    if (!proof2) {
      if (!proof2) {
        throw new Error("Proof to merge with not found");
      }
    }

    console.time(`merge`);
    const { proof } = await ledgerZkProgram.merge(
      proof1.publicInput,
      proof1,
      proof2
    );
    console.timeEnd(`merge`);

    // Remove the two proofs that were just merged
    proofs = proofs.filter((p) => p !== proof1 && p !== proof2);

    Provable.log("merge proof", proof.publicInput, proof.publicOutput);

    proofs.push(proof);
  }

  const proofSize = new TextEncoder().encode(
    JSON.stringify(proofs[0].toJSON())
  ).length;

  console.log("merge proof size", proofSize);
  Provable.log("final proof", proofs[0].publicInput, proofs[0].publicOutput);

  const index = 0;
  const account = accounts[index.toString()]!;
  const witness = new MerkleWitness32(
    votingLedgerTree.getWitness(BigInt(index))
  );
  const votingAccount = new VotingAccount({
    balance: account.balance,
  });
  const votingAccountHash = Poseidon.hash(
    VotingAccount.toFields(votingAccount)
  );

  const votingLedgerRoot = witness.calculateRoot(votingAccountHash);
  Provable.log("voting ledger root", votingLedgerRoot.toString());
  Provable.log(
    "proofs[0].publicOutput.votingLedgerRoot",
    proofs[0].publicOutput.votingLedgerRoot.toString()
  );
  assert(
    votingLedgerRoot.toString() ===
      proofs[0].publicOutput.votingLedgerRoot.toString(),
    "calculated voting ledger root does not match the proven voting ledger root"
  );
});

it("should create an exhaust proof", async () => {
  const mergeProof = proofs[0];
  const { proof } = await ledgerZkProgram.exhaust(
    mergeProof.publicInput,
    mergeProof
  );
  Provable.log("exhaust proof", proof.publicInput, proof.publicOutput);
  Provable.log(
    "Voting ledger tree root",
    testVotingLedgerTree.getRoot().toString()
  );

  assert(
    testVotingLedgerTree.getRoot().toString() ===
      proof.publicOutput.votingLedgerRoot.toString()
  );
  assert(proof.publicOutput.exhausted.toBoolean());
  assert(proof.publicInput.index.toBigint() === 0n);
  assert(
    proof.publicOutput.index.toBigint() ===
      BigInt(ACCOUNT_BATCH_SIZE * TEST_ITERATIONS - 1)
  );
});
