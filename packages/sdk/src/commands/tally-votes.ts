import { Command } from "commander";
import {
  fetchAccount,
  Field,
  MerkleTree,
  Mina,
  PrivateKey,
  Provable,
  PublicKey,
  Reducer,
  UInt32,
  UInt64,
} from "o1js";
import {
  LIFECYCLE_PERIOD_DURATION,
  TreasuryOwnerSmartContract,
} from "../provable/contracts/treasury-owner.js";
import { compileTreasuryContracts } from "./deploy-treasury-owner.js";
import { TreasuryProposalSmartContract } from "../provable/contracts/treasury-proposal/treasury-proposal.js";
import {
  SideLoadedVoteReducerProof,
  Vote,
  VOTE_ACTION_BATCH_SIZE,
  VoteAction,
  VoteReducer,
  voteReducerContext,
} from "../provable/contracts/treasury-proposal/vote-reducer.js";
import { createDummyVoteActions } from "test/utils.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  VOTING_LEDGER_TREE_HEIGHT,
} from "../provable/staking-ledger-to-voting-ledger.js";
import { VotingAccountInMemoryService } from "../services/voting-account-service.js";
import { VoteNullifierInMemoryService } from "../services/vote-nullifier-service.js";
import { MerkleTree256InMemoryService } from "../services/merkle-tree-service.js";
import { PrefilledMerkleTree256InMemoryService } from "../services/merkle-tree-service.js";
import { readFileSync, writeFileSync } from "fs";

export default function tallyVotesCommandFactory(program: Command) {
  program
    .command("tally-votes")
    .requiredOption(
      "--treasury-owner-public-key <treasury-owner-public-key>",
      "Treasury owner public key",
      (value) => PublicKey.fromBase58(value)
    )
    .option(
      "--treasury-owner-private-key <treasury-owner-private-key>",
      "Treasury owner private key",
      (value) => PrivateKey.fromBase58(value)
    )
    .requiredOption(
      "--proposal-public-key <proposal-public-key>",
      "Public key of the proposal",
      (value) => PublicKey.fromBase58(value)
    )
    .option(
      "--proposal-private-key <proposal-private-key>",
      "Private key of the proposal",
      (value) => PrivateKey.fromBase58(value)
    )
    .requiredOption(
      "--lifecycle-period-duration <lifecycle-period-duration>",
      "Duration of the lifecycle period",
      (value) => UInt32.from(value),
      LIFECYCLE_PERIOD_DURATION
    )
    .requiredOption(
      "--mina-node-url <mina-node-url>",
      "URL of the Mina node to use"
    )
    .requiredOption(
      "--mina-archive-url <mina-archive-url>",
      "URL of the Mina archive to use"
    )
    .requiredOption(
      "--voting-ledger-input-path <voting-ledger-input-path>",
      "Path to the voting ledger input file"
    )
    .requiredOption(
      "--staking-ledger-to-voting-ledger-proof-input-path <staking-ledger-to-voting-ledger-proof-input-path>",
      "Path to the staking ledger to voting ledger proof input file"
    )
    .option(
      "--permission-type <permission-type>",
      "Set of permissions for interacting with the proposal",
      (value) => value as "proof" | "signature",
      "proof"
    )
    .option(
      "--fee <fee>",
      "Fee to pay for the transaction",
      (value) => UInt64.from(value),
      UInt64.from(1 * 10 ** 9) // 1 MINA TODO: figure out what is the default fee
    )
    .requiredOption(
      "--sender-private-key <sender-private-key>",
      "Private key of the sender",
      (value) => PrivateKey.fromBase58(value)
    )
    .option("--nonce <nonce>", "Nonce to use for the transaction", parseInt)
    .action(
      async ({
        proposalPublicKey,
        proposalPrivateKey,
        permissionType,
        treasuryOwnerPrivateKey,
        fee,
        nonce,
        lifecyclePeriodDuration,
        minaNodeUrl,
        treasuryOwnerPublicKey,
        senderPrivateKey,
        minaArchiveUrl,
        votingLedgerInputPath,
        stakingLedgerToVotingLedgerProofInputPath,
      }: {
        proposalPublicKey: PublicKey;
        treasuryOwnerPublicKey: PublicKey;
        treasuryOwnerPrivateKey: PrivateKey;
        lifecyclePeriodDuration: UInt32;
        minaNodeUrl: string;
        proposalPrivateKey: PrivateKey;
        permissionType: "proof" | "signature";
        fee: UInt64;
        nonce: number;
        senderPrivateKey: PrivateKey;
        minaArchiveUrl: string;
        votingLedgerInputPath: string;
        stakingLedgerToVotingLedgerProofInputPath: string;
      }) => {
        TreasuryProposalSmartContract.permissionType = permissionType;

        await compileTreasuryContracts(lifecyclePeriodDuration);

        const Network = Mina.Network({
          mina: minaNodeUrl,
          archive: minaArchiveUrl,
        });
        Mina.setActiveInstance(Network);

        const treasuryOwner = new TreasuryOwnerSmartContract(
          treasuryOwnerPublicKey
        );
        const proposal = new TreasuryProposalSmartContract(
          proposalPublicKey,
          treasuryOwner.deriveTokenId()
        );

        const actions = await Mina.fetchActions(
          proposalPublicKey,
          {},
          treasuryOwner.deriveTokenId()
        );

        if (actions["statusCode"]) {
          throw new Error(actions["statusText"]);
        }

        const voteActions = (actions as { actions: string[][] }[])
          .flatMap((actions) => actions.actions)
          .map((action) => action.map((field) => Field(field)))
          .map((action) => VoteAction.fromFields(action));

        Provable.log(
          "votes",
          voteActions.map((action) => ({
            vote: (() => {
              switch (action.vote.toBigInt()) {
                case Vote.YAY.toBigInt():
                  return "YAY";
                case Vote.NAY.toBigInt():
                  return "NAY";
                case Vote.ABSTRAIN.toBigInt():
                  return "ABSTRAIN";
                default:
                  throw new Error(`Invalid vote: ${action.vote.toBigInt()}`);
              }
            })(),
            publicKey: action.publicKey.toBase58(),
          }))
        );

        // TODO: for demo purposes we only do one batch of votes
        const missingVoteActions = VOTE_ACTION_BATCH_SIZE - voteActions.length;
        if (missingVoteActions > 0) {
          for (let i = 0; i < missingVoteActions; i++) {
            voteActions.push(VoteAction.dummy());
          }
        }

        // TODO: demo purposes only, remove this
        if (voteActions.length !== VOTE_ACTION_BATCH_SIZE) {
          throw new Error(
            `Expected ${VOTE_ACTION_BATCH_SIZE} vote actions, got ${voteActions.length}`
          );
        }

        Provable.log("votingLedgerInputPath", votingLedgerInputPath);
        const votingAccountService = VotingAccountInMemoryService.fromFile(
          process.cwd() + "/" + votingLedgerInputPath
        );

        Provable.log("creating merkle tree service");
        const votingAccountTreeService =
          await votingAccountService.toMerkleTreeService();
        const voteNullifierService = new VoteNullifierInMemoryService();
        const voteNullifierTreeService = new MerkleTree256InMemoryService();

        voteReducerContext.set({
          votingAccountTree: votingAccountTreeService,
          votingAccounts: votingAccountService,
          voteNullifiers: voteNullifierService,
          voteNullifierTree: voteNullifierTreeService,
        });

        Provable.log("tallying votes");
        const proof = await VoteReducer.reduceBatch(
          {
            fromActionsHash: Reducer.initialActionState,
            votingLedgerRoot: votingAccountTreeService.tree.getRoot(),
            fromNullifierRoot: voteNullifierTreeService.tree.getRoot(),
            yay: UInt64.from(0),
            nay: UInt64.from(0),
            abstain: UInt64.from(0),
          },
          voteActions
        );

        const stakingLedgerToVotingLedgerProofJSON = JSON.parse(
          readFileSync(stakingLedgerToVotingLedgerProofInputPath, "utf8")
        );

        await fetchAccount({
          publicKey: proposalPublicKey,
          tokenId: treasuryOwner.deriveTokenId(),
        });

        await Mina.fetchActions(
          proposalPublicKey,
          {},
          treasuryOwner.deriveTokenId()
        );

        Provable.log("submitting tallied votes", {
          proof: proof.proof.publicOutput,
          voteActions,
        });

        const tx = await Mina.transaction(
          {
            sender: senderPrivateKey.toPublicKey(),
            fee,
            nonce,
          },
          async () => {
            await treasuryOwner.tallyVotes(
              proposalPublicKey,
              SideLoadedVoteReducerProof.fromProof(proof.proof),
              await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
                stakingLedgerToVotingLedgerProofJSON
              )
            );

            if (permissionType == "signature") {
              treasuryOwner.self.requireSignature();
            }
          }
        );

        tx.sign(
          permissionType == "signature"
            ? [senderPrivateKey, treasuryOwnerPrivateKey, proposalPrivateKey]
            : [senderPrivateKey]
        );

        if (permissionType == "proof") {
          console.time("prove");
          await tx.prove();
          console.timeEnd("prove");
        }

        Provable.log("tx", tx.toPretty());

        const pendingTx = await tx.send();
        Provable.log("waiting for transaction to be included", pendingTx.hash);
        const includedTx = await pendingTx.wait();
        Provable.log("Tally votes successful", includedTx);
      }
    );
}
