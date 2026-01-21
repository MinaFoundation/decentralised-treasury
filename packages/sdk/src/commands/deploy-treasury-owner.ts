import { Command, Option } from "commander";
import {
  AccountUpdate,
  fetchAccount,
  Mina,
  Permissions,
  Poseidon,
  PrivateKey,
  Provable,
  PublicKey,
  UInt32,
  UInt64,
} from "o1js";
import {
  LIFECYCLE_PERIOD_DURATION,
  MULTISIG_SIGNATURES_COUNT,
  TreasuryOwnerSmartContract,
} from "../provable/contracts/treasury-owner.js";
import { TreasuryProposalSmartContract } from "../provable/contracts/treasury-proposal/treasury-proposal.js";
import { BaseVotingLedger } from "../ledgers/voting-ledger/voting-ledger.js";
import { BaseNullifierLedger } from "../ledgers/nullifier-ledger/nullifier-ledger.js";
import { MemoryVotingAccountStorage } from "../storage/memory-voting-account-storage.js";
import { MemoryMerkleTreeStorage } from "../storage/memory-merkle-tree-storage.js";
import { MemoryVoteNullifierStorage } from "../storage/memory-vote-nullifier-storage.js";
import {
  VoteReducer,
  voteReducerContext,
} from "../provable/contracts/treasury-proposal/vote-reducer.js";
import { StakingLedgerToVotingLedger } from "../provable/staking-ledger-to-voting-ledger.js";

export async function compileTreasuryContracts(
  lifecyclePeriodDuration: UInt32 = LIFECYCLE_PERIOD_DURATION
) {
  const votingAccountStorage = new MemoryVotingAccountStorage();
  const votingMerkleTreeStorage = new MemoryMerkleTreeStorage();
  const nullifierStorage = new MemoryVoteNullifierStorage();
  const nullifierMerkleTreeStorage = new MemoryMerkleTreeStorage();

  const votingLedger = new BaseVotingLedger(
    votingAccountStorage,
    votingMerkleTreeStorage
  );
  const nullifierLedger = new BaseNullifierLedger(
    nullifierStorage,
    nullifierMerkleTreeStorage
  );

  voteReducerContext.set({
    votingLedger,
    nullifierLedger,
  });

  // TODO: probably some context is missing here for either of these compile calls, migth fail with proofsEnabled: true
  const { verificationKey: voteReducerVerificationKey } =
    await VoteReducer.compile({
      proofsEnabled: process.env.PROOFS_ENABLED === "true",
    });

  const { verificationKey: stakingLedgerToVotingLedgerVerificationKey } =
    await StakingLedgerToVotingLedger.compile({
      proofsEnabled: process.env.PROOFS_ENABLED === "true",
    });

  TreasuryProposalSmartContract.voteReducerVerificationKey =
    voteReducerVerificationKey;
  TreasuryProposalSmartContract.stakingLedgerToVotingLedgerVerificationKey =
    stakingLedgerToVotingLedgerVerificationKey;

  console.log("compiling TreasuryProposalSmartContract");
  console.time("compile TreasuryProposalSmartContract");
  await TreasuryProposalSmartContract.compile();
  TreasuryOwnerSmartContract.proposalContractVerificationKey =
    TreasuryProposalSmartContract._verificationKey;
  TreasuryOwnerSmartContract.lifecyclePeriodDuration = lifecyclePeriodDuration;
  Provable.log("lifecyclePeriodDuration", lifecyclePeriodDuration);
  console.timeEnd("compile TreasuryProposalSmartContract");

  console.log("compiling TreasuryOwnerSmartContract");
  console.time("compile TreasuryOwnerSmartContract");
  await TreasuryOwnerSmartContract.compile();
  console.timeEnd("compile TreasuryOwnerSmartContract");
}

export default function deployTreasuryOwnerCommandFactory(program: Command) {
  program
    .command("deploy-treasury-owner")
    // TODO: implement better key management
    .requiredOption<PrivateKey>(
      "--treasury-owner-private-key <treasury-owner-private-key>",
      "Private key of the treasury owner",
      (value) => PrivateKey.fromBase58(value),
      PrivateKey.random()
    )
    .requiredOption(
      "--treasury-deployed-at-slot <treasury-deployed-at-slot>",
      "Slot at which the treasury lifecycle starts",
      (value) => UInt32.from(value)
    )
    .requiredOption(
      "--multisig-participants-public-keys <multisig-participants-public-keys>",
      "Comma separated list of multisig participants public keys",
      (value) => {
        const keys = value.split(",").map((key) => PublicKey.fromBase58(key));
        if (keys.length !== MULTISIG_SIGNATURES_COUNT) {
          throw new Error(
            `Expected ${MULTISIG_SIGNATURES_COUNT} multisig participants public keys, got ${keys.length}. Use comma separated list of public keys.`
          );
        }
        return keys;
      },
      [
        PrivateKey.random().toPublicKey(),
        PrivateKey.random().toPublicKey(),
        PrivateKey.random().toPublicKey(),
      ]
    )
    .addOption(
      new Option(
        "--permission-type <permission-type>",
        "Set of permissions for interacting with the treasury owner"
      )
        .choices(["proof", "signature"])
        .default("proof")
    )
    .requiredOption(
      "--mina-node-url <mina-node-url>",
      "URL of the Mina node to use"
    )
    .option(
      "--sender-private-key <sender-private-key>",
      "Sender of the transaction",
      (value) => PrivateKey.fromBase58(value),
      PrivateKey.random()
    )
    .option(
      "--fee <fee>",
      "Fee to pay for the transaction",
      (value) => UInt64.from(value),
      UInt64.from(1 * 10 ** 9) // 1 MINA TODO: figure out what is the default fee
    )
    .option("--nonce <nonce>", "Nonce to use for the transaction", parseInt)
    .option("--memo <memo>", "Memo to use for the transaction")
    .option(
      "--skip-deploy",
      "Skip deploying the treasury owner contract, only initialize it",
      false
    )
    .option(
      "--lifecycle-period-duration <lifecycle-period-duration>",
      "Duration of the lifecycle period",
      (value) => UInt32.from(value),
      LIFECYCLE_PERIOD_DURATION
    )
    .action(
      async ({
        treasuryOwnerPrivateKey,
        treasuryDeployedAtSlot,
        multisigParticipantsPublicKeys,
        permissionType,
        minaNodeUrl,
        senderPrivateKey,
        fee,
        nonce,
        memo,
        skipDeploy,
        lifecyclePeriodDuration,
      }: {
        treasuryOwnerPrivateKey: PrivateKey;
        treasuryDeployedAtSlot: UInt32;
        multisigParticipantsPublicKeys: PublicKey[];
        permissionType: string;
        minaNodeUrl: string;
        senderPrivateKey: PrivateKey;
        fee: UInt64 | undefined;
        nonce: number | undefined;
        memo: string | undefined;
        skipDeploy: boolean;
        lifecyclePeriodDuration: UInt32;
      }) => {
        await compileTreasuryContracts(lifecyclePeriodDuration);

        const Network = Mina.Network({
          mina: minaNodeUrl,
        });
        Mina.setActiveInstance(Network);

        const treasuryOwner = new TreasuryOwnerSmartContract(
          treasuryOwnerPrivateKey.toPublicKey()
        );

        if (!skipDeploy) {
          console.log(
            "Deploying TreasuryOwnerSmartContract at",
            treasuryOwnerPrivateKey.toPublicKey().toBase58()
          );

          await (async () => {
            const tx = await Mina.transaction(
              { sender: senderPrivateKey.toPublicKey(), fee, nonce, memo },
              async () => {
                AccountUpdate.fundNewAccount(senderPrivateKey.toPublicKey(), 1);
                await treasuryOwner.deploy();

                if (permissionType == "signature") {
                  treasuryOwner.account.permissions.set({
                    ...Permissions.default(),
                    editState: Permissions.signature(),
                    send: Permissions.signature(),
                    editActionState: Permissions.signature(),
                  });
                }
              }
            );

            tx.sign([senderPrivateKey, treasuryOwnerPrivateKey]);

            Provable.log("sending transaction");
            const pendingTx = await tx.send();
            Provable.log(
              "waiting for transaction to be included",
              pendingTx.hash
            );
            const includedTx = await pendingTx.wait();

            Provable.log("Deployment successful", includedTx);
          })();
        }

        const { error } = await fetchAccount({
          publicKey: treasuryOwnerPrivateKey.toPublicKey(),
        });

        if (error) throw error;

        Provable.log("initializing TreasuryOwnerSmartContract");
        await (async () => {
          const tx = await Mina.transaction(
            { sender: senderPrivateKey.toPublicKey(), fee, nonce, memo },
            async () => {
              await treasuryOwner.initialize(
                treasuryDeployedAtSlot,
                Poseidon.hash(
                  multisigParticipantsPublicKeys.flatMap((key) =>
                    key.toFields()
                  )
                )
              );

              if (permissionType == "signature") {
                treasuryOwner.self.requireSignature();
              }
            }
          );

          tx.sign([senderPrivateKey, treasuryOwnerPrivateKey]);

          if (permissionType == "proof") {
            console.time("prove");
            await tx.prove();
            console.timeEnd("prove");
          }

          Provable.log("sending transaction");
          Provable.log("tx", tx.toPretty());
          const pendingTx = await tx.send();
          Provable.log(
            "waiting for transaction to be included",
            pendingTx.hash
          );
          const includedTx = await pendingTx.wait();

          Provable.log("Initialization successful", includedTx);
        })();
      }
    );
}
