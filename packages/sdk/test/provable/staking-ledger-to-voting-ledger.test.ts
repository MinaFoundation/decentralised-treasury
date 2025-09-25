import { it } from "node:test";
import assert from "node:assert";
import { ocamlToGraphQL } from "../../src/mappers/account-mapper.js";
import { createTestAccounts } from "../../src/create-test-accounts.js";
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
  StakingLedgerToVotingLedger,
  stakingLedgerToVotingLedgerContext,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
  VOTING_LEDGER_TREE_HEIGHT,
  VotingAccount,
} from "../../src/provable/staking-ledger-to-voting-ledger.js";
import _, { orderBy } from "lodash";
import {
  MerkleWitness256,
  MerkleWitness32,
  PrefilledMerkleTree256InMemoryService,
  PrefilledMerkleTree32InMemoryService,
  MerkleTree32InMemoryService,
  MerkleTree256InMemoryService,
} from "../../src/services/merkle-tree-service.js";
import { VotingAccountInMemoryService } from "../../src/services/voting-account-service.js";
export const proofsEnabled = process.env.PROOFS_ENABLED === "true";

const stakingLedgerTreeService = new MerkleTree32InMemoryService();
const votingLedgerTreeService = new MerkleTree256InMemoryService();
const votingAccountService = new VotingAccountInMemoryService();

stakingLedgerToVotingLedgerContext.set({
  stakingLedgerTree: stakingLedgerTreeService,
  votingLedgerTree: votingLedgerTreeService,
  votingAccounts: votingAccountService,
});

let proofs: Proof<
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput
>[] = [];

it("should compile the program", async () => {
  await StakingLedgerToVotingLedger.compile({
    proofsEnabled,
  });
});

it("should analyze the program", async () => {
  const analysis = await StakingLedgerToVotingLedger.analyzeMethods();
  Provable.log("analysis", analysis);
});

export const TEST_ITERATIONS = 5;
const testAccounts = [
  ...(await createTestAccounts(ACCOUNT_BATCH_SIZE * TEST_ITERATIONS - 1)),
  Account.dummy(),
];

it("should digest a range of indexes", async () => {
  // populate circuit consumable variables
  testAccounts.forEach((account, index) => {
    if (!Account.isDummy(account).toBoolean()) {
      stakingLedgerTreeService.setLeaf(
        BigInt(index),
        Poseidon.hash(Account.toFields(account))
      );
    }
  });

  console.log("digesting total of", testAccounts.length, "accounts");
  for (let i = 0; i < TEST_ITERATIONS; i++) {
    const input = {
      index: UInt32.from(i * ACCOUNT_BATCH_SIZE),
      totalCurrency: UInt64.from(0),
      stakingLedgerRoot: stakingLedgerTreeService.tree.getRoot(),
      votingLedgerRoot: votingLedgerTreeService.tree.getRoot(),
    };

    const accounts = testAccounts.slice(
      i * ACCOUNT_BATCH_SIZE,
      (i + 1) * ACCOUNT_BATCH_SIZE
    );
    console.time(`digest ${i}`);
    const { proof } = await StakingLedgerToVotingLedger.digest(input, accounts);
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
    const { proof } = await StakingLedgerToVotingLedger.merge(
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

  Provable.log("final proof", proofs[0].publicInput, proofs[0].publicOutput);
  Provable.log(
    "voting ledger tree root",
    votingLedgerTreeService.tree.getRoot().toString()
  );
  assert(
    votingLedgerTreeService.tree.getRoot().toString() ===
      proofs[0].publicOutput.votingLedgerRoot.toString(),
    "calculated voting ledger root does not match the proven voting ledger root"
  );
});

it("should create an exhaust proof", async () => {
  const mergeProof = proofs[0];
  const { proof } = await StakingLedgerToVotingLedger.exhaust(
    mergeProof.publicInput,
    mergeProof
  );
  Provable.log("exhaust proof", proof.publicInput, proof.publicOutput);
  Provable.log(
    "Voting ledger tree root",
    votingLedgerTreeService.tree.getRoot().toString()
  );

  assert(
    votingLedgerTreeService.tree.getRoot().toString() ===
      proof.publicOutput.votingLedgerRoot.toString()
  );
  assert(proof.publicOutput.exhausted.toBoolean());
  assert(proof.publicInput.index.toBigint() === 0n);
  assert(
    proof.publicOutput.index.toBigint() ===
      BigInt(ACCOUNT_BATCH_SIZE * TEST_ITERATIONS - 1)
  );
});
