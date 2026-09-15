import {
  AccountUpdate,
  Field,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  TokenId,
  UInt32,
  UInt64,
  VerificationKey,
  ZkappUri,
} from "o1js";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
} from "../../../src/ledgers/staking-ledger/staking-ledger.js";
import { Account, packToFields } from "../../../src/provable/account.js";
import {
  LIFECYCLE_PERIOD_DURATION,
  TreasuryOwnerSmartContract,
} from "../../../src/provable/contracts/treasury-owner.js";
import { BOND_AMOUNT_DIVISOR } from "../../../src/provable/contracts/treasury-constants.js";
import { hashWithPrefix } from "../../../src/provable/hashing-helpers.js";
import { PrefixedMerkleTree } from "../../../src/provable/merkle-tree/prefixed-merkle-tree.js";
import { TreasuryPauseControllerSmartContract } from "../../../src/provable/contracts/treasury-pause-controller/treasury-pause-controller.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "../../../src/provable/contracts/treasury-proposal/treasury-proposal.js";
import type { MerkleTreeStorage } from "../../../src/storage/merkle-tree-storage.js";
import { createLocalBlockchain } from "../../provable/context/contracts/mina-local.js";

const fee = UInt64.from(100_000_000);
const proposalAmount = UInt64.from(1_000_000_000);
const treasuryFunding = UInt64.from(10_000_000_000);
const pauseControllerKey = PrivateKey.fromBigInt(40_001n);
const ownerKey = PrivateKey.fromBigInt(40_002n);
const proposalKey = PrivateKey.fromBigInt(40_003n);
const standaloneProposalKey = PrivateKey.fromBigInt(40_004n);
const multisigKeys = Array.from({ length: 5 }, (_, index) =>
  PrivateKey.fromBigInt(BigInt(40_100 + index)),
);

class MemoryMerkleStorage implements MerkleTreeStorage {
  public readonly namespace = "contract-authorization-staking";
  readonly #nodes = new Map<string, Field>();

  public async getNode(
    level: number,
    index: bigint,
  ): Promise<Field | undefined> {
    return this.#nodes.get(`${level}:${index}`);
  }

  public async setNode(
    level: number,
    index: bigint,
    value: Field,
  ): Promise<void> {
    this.#nodes.set(`${level}:${index}`, value);
  }

  public async clear(): Promise<void> {
    this.#nodes.clear();
  }

  public async close(): Promise<void> {
    this.#nodes.clear();
  }
}

export async function compileAuthorizationContracts(
  proofsEnabled: boolean,
): Promise<void> {
  if (proofsEnabled) {
    throw new Error("This contract authorization lane is proof-off only.");
  }
  const dummyVerificationKey = VerificationKey.dummySync();
  TreasuryProposalSmartContract.voteReducerVerificationKey =
    dummyVerificationKey;
  TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
    dummyVerificationKey;
  TreasuryProposalSmartContract.emptyNullifierRoot = Field(0);
  TreasuryProposalSmartContract.emptyVotingLedgerRoot = Field(0);
  TreasuryPauseControllerSmartContract.multisigParticipants = multisigKeys.map(
    (key) => key.toPublicKey(),
  );
  TreasuryOwnerSmartContract.treasuryDeployedAtSlot = UInt32.from(0);
  TreasuryOwnerSmartContract.pauseControllerPublicKey =
    pauseControllerKey.toPublicKey();

  const { verificationKey } = await TreasuryProposalSmartContract.compile();
  TreasuryOwnerSmartContract.proposalContractVerificationKey = verificationKey;
  await TreasuryPauseControllerSmartContract.compile();
  await TreasuryOwnerSmartContract.compile();
}

export async function sendTransaction(
  sender: { key: PrivateKey },
  callback: () => Promise<void>,
  additionalKeys: readonly PrivateKey[] = [],
): Promise<void> {
  const transaction = await Mina.transaction(
    { sender: sender.key.toPublicKey(), fee },
    callback,
  );
  await transaction.prove();
  transaction.sign([sender.key, ...additionalKeys]);
  const pending = await transaction.send();
  await pending.wait();
}

export async function createOwnerDeploymentFixture() {
  const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
  const { blockchain, feePayer } = await createLocalBlockchain(proofsEnabled);
  const pauseController = new TreasuryPauseControllerSmartContract(
    pauseControllerKey.toPublicKey(),
  );
  const owner = new TreasuryOwnerSmartContract(ownerKey.toPublicKey());

  await sendTransaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
    await pauseController.deploy();
  }, [pauseControllerKey]);
  await sendTransaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
    await owner.deploy();
  }, [ownerKey]);

  return { blockchain, feePayer, pauseController, owner };
}

export async function submitProposal(
  fixture: Awaited<ReturnType<typeof createOwnerDeploymentFixture>>,
  options: {
    amount?: UInt64;
    lifecycleId?: UInt32;
    proposalKeyValue?: bigint;
    senderIndex?: number;
    bondPayerIndex?: number;
    recipientIndex?: number;
  } = {},
) {
  const proposalPrivateKey = PrivateKey.fromBigInt(
    options.proposalKeyValue ?? 41_000n,
  );
  const proposal = new TreasuryProposalSmartContract(
    proposalPrivateKey.toPublicKey(),
    fixture.owner.deriveTokenId(),
  );
  const sender = fixture.blockchain.testAccounts[options.senderIndex ?? 0]!;
  const bondPayer =
    fixture.blockchain.testAccounts[options.bondPayerIndex ?? 0]!;
  const recipient =
    fixture.blockchain.testAccounts[
      options.recipientIndex ?? 3
    ]!.key.toPublicKey();
  const amount = options.amount ?? proposalAmount;
  const keys = [proposalPrivateKey];
  if (bondPayer.key.toBase58() !== sender.key.toBase58())
    keys.push(bondPayer.key);

  await sendTransaction(
    sender,
    async () => {
      AccountUpdate.fundNewAccount(sender.key.toPublicKey(), 1);
      const bondUpdate = AccountUpdate.createSigned(
        bondPayer.key.toPublicKey(),
      );
      bondUpdate.balance.subInPlace(amount.div(BOND_AMOUNT_DIVISOR));
      await fixture.owner.createProposal(
        proposal.address,
        {
          amount,
          recipient,
          zkAppUri: ZkappUri.from("https://assurance.invalid/proposal"),
        },
        options.lifecycleId ?? UInt32.from(0),
      );
    },
    keys,
  );

  return { proposal, proposalPrivateKey, sender, bondPayer, recipient, amount };
}

export async function createOwnerProposalFixture(
  options: { stakingSnapshot?: boolean } = {},
) {
  const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
  const { blockchain, feePayer } = await createLocalBlockchain(proofsEnabled);
  const pauseController = new TreasuryPauseControllerSmartContract(
    pauseControllerKey.toPublicKey(),
  );
  const owner = new TreasuryOwnerSmartContract(ownerKey.toPublicKey());
  const proposalTokenId = owner.deriveTokenId();
  const proposal = new TreasuryProposalSmartContract(
    proposalKey.toPublicKey(),
    proposalTokenId,
  );

  await sendTransaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
    await pauseController.deploy();
  }, [pauseControllerKey]);
  await sendTransaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
    await owner.deploy();
  }, [ownerKey]);

  let treasurySnapshotAccount: Account | undefined;
  let treasurySnapshotWitness:
    | Awaited<ReturnType<PrefixedMerkleTree["getWitness"]>>
    | undefined;
  let stakingLedgerRoot: Field | undefined;
  if (options.stakingSnapshot === true) {
    await sendTransaction(feePayer, async () => {
      const fundingUpdate = AccountUpdate.createSigned(
        feePayer.key.toPublicKey(),
      );
      fundingUpdate.balance.subInPlace(treasuryFunding);
      await owner.receive(treasuryFunding);
    });

    treasurySnapshotAccount = Account.empty();
    treasurySnapshotAccount.pk = owner.address;
    treasurySnapshotAccount.delegate = owner.address;
    treasurySnapshotAccount.balance = treasuryFunding;
    const emptyAccount = Account.empty();
    const emptyLeaf = hashWithPrefix(
      accountHashPrefix,
      packToFields(Account.toHashInput(emptyAccount)),
    );
    const tree = new PrefixedMerkleTree(
      36,
      emptyLeaf,
      accountLedgerHashPrefixes,
      new MemoryMerkleStorage(),
    );
    await tree.setLeaf(
      0n,
      hashWithPrefix(
        accountHashPrefix,
        packToFields(Account.toHashInput(treasurySnapshotAccount)),
      ),
    );
    stakingLedgerRoot = await tree.getRoot();
    treasurySnapshotWitness = await tree.getWitness(0n);
    blockchain.setNetworkState({
      ...blockchain.getNetworkState(),
      stakingEpochData: {
        ...blockchain.getNetworkState().stakingEpochData,
        ledger: {
          ...blockchain.getNetworkState().stakingEpochData.ledger,
          hash: stakingLedgerRoot,
          totalCurrency: treasuryFunding,
        },
      },
    });
  }

  await sendTransaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
    const bondPayer = AccountUpdate.createSigned(feePayer.key.toPublicKey());
    bondPayer.balance.subInPlace(proposalAmount.div(BOND_AMOUNT_DIVISOR));
    await owner.createProposal(
      proposalKey.toPublicKey(),
      {
        amount: proposalAmount,
        recipient: blockchain.testAccounts[3]!.key.toPublicKey(),
        zkAppUri: ZkappUri.from("https://assurance.invalid/proposal"),
      },
      UInt32.from(0),
    );
  }, [proposalKey]);

  blockchain.incrementGlobalSlot(LIFECYCLE_PERIOD_DURATION.mul(2));

  return {
    blockchain,
    feePayer,
    owner,
    proposal,
    proposalKey,
    proposalTokenId,
    proposalAmount,
    stakingLedgerRoot,
    treasurySnapshotAccount,
    treasurySnapshotWitness,
  };
}

export async function createStandaloneProposalFixture(
  options: {
    status?: Field;
    amount?: UInt64;
    paidOutAmount?: UInt64;
    recipient?: PublicKey;
  } = {},
) {
  const proofsEnabled = String(process.env.PROOFS_ENABLED) === "true";
  const { blockchain, feePayer } = await createLocalBlockchain(proofsEnabled);
  const proposal = new TreasuryProposalSmartContract(
    standaloneProposalKey.toPublicKey(),
    TokenId.default,
  );
  const recipient =
    options.recipient ?? blockchain.testAccounts[3]!.key.toPublicKey();
  await sendTransaction(feePayer, async () => {
    AccountUpdate.fundNewAccount(feePayer.key.toPublicKey(), 1);
    await proposal.deploy();
    if (options.status !== undefined) proposal.status.set(options.status);
    if (options.amount !== undefined) proposal.amount.set(options.amount);
    if (options.paidOutAmount !== undefined) {
      proposal.paidOutAmount.set(options.paidOutAmount);
    }
    proposal.recipientHash.set(Poseidon.hash(recipient.toFields()));
  }, [standaloneProposalKey]);
  return { blockchain, feePayer, proposal, recipient };
}

export function currentActionState(
  blockchain: Mina.LocalBlockchain,
  proposal: TreasuryProposalSmartContract,
): string {
  const zkapp = blockchain.getAccount(proposal.address, proposal.tokenId).zkapp;
  if (zkapp === undefined) throw new Error("Proposal zkApp state is missing.");
  return zkapp.actionState[0]!.toString();
}
