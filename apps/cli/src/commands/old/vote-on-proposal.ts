import { Command, Option } from "commander";
import { Mina, PrivateKey, Provable, PublicKey, UInt32, UInt64 } from "o1js";
import {
  LIFECYCLE_PERIOD_DURATION,
  TreasuryOwnerSmartContract,
} from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import { TreasuryProposalSmartContract } from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { Vote } from "@repo/sdk/src/provable/contracts/treasury-proposal/vote-reducer.js";
import { compileTreasuryContracts } from "./deploy-treasury-owner.js";

export default function voteOnProposalCommandFactory(program: Command) {
  program
    .command("vote-on-proposal")
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
    .option(
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
      "--voter-private-key <voter-private-key>",
      "Private key of the voter",
      (value) => PrivateKey.fromBase58(value)
    )
    .requiredOption(
      "--sender-private-key <sender-private-key>",
      "Private key of the sender",
      (value) => PrivateKey.fromBase58(value)
    )
    .option(
      "--fee <fee>",
      "Fee to pay for the transaction",
      (value) => UInt64.from(value),
      UInt64.from(1 * 10 ** 9) // 1 MINA TODO: figure out what is the default fee
    )
    .option("--nonce <nonce>", "Nonce to use for the transaction", (value) =>
      parseInt(value)
    )
    .addOption(
      new Option("--vote <vote>", "Vote to cast")
        .choices(["yay", "nay", "abstain"])
        .makeOptionMandatory()
        .argParser((value) => {
          switch (value) {
            case "yay":
              return Vote.YAY;
            case "nay":
              return Vote.NAY;
            case "abstain":
              return Vote.ABSTRAIN;
            default:
              throw new Error(`Invalid vote: ${value}`);
          }
        })
    )
    .addOption(
      new Option(
        "--permission-type <permission-type>",
        "Set of permissions for interacting with the treasury owner"
      )
        .choices(["proof", "signature"])
        .default("proof")
    )
    .action(
      async ({
        proposalPublicKey,
        proposalPrivateKey,
        minaNodeUrl,
        treasuryOwnerPublicKey,
        voterPrivateKey,
        vote,
        senderPrivateKey,
        fee,
        nonce,
        permissionType,
        lifecyclePeriodDuration,
        treasuryOwnerPrivateKey,
      }: {
        proposalPublicKey: PublicKey;
        proposalPrivateKey: PrivateKey;
        minaNodeUrl: string;
        treasuryOwnerPublicKey: PublicKey;
        voterPrivateKey: PrivateKey;
        vote: Vote;
        senderPrivateKey: PrivateKey;
        fee: UInt64;
        nonce: number;
        permissionType: "proof" | "signature";
        lifecyclePeriodDuration: UInt32;
        treasuryOwnerPrivateKey: PrivateKey;
      }) => {
        await compileTreasuryContracts(lifecyclePeriodDuration);
        const Network = Mina.Network({
          mina: minaNodeUrl,
        });
        Mina.setActiveInstance(Network);

        const treasuryOwner = new TreasuryOwnerSmartContract(
          treasuryOwnerPublicKey
        );

        TreasuryProposalSmartContract.permissionType = permissionType;

        Provable.log(
          "Voting on proposal",
          (() => {
            switch (vote) {
              case Vote.YAY:
                return "YAY";
              case Vote.NAY:
                return "NAY";
              case Vote.ABSTRAIN:
                return "ABSTRAIN";
              default:
                throw new Error(`Invalid vote: ${vote}`);
            }
          })(),
          {
            proposalPublicKey: proposalPublicKey.toBase58(),
            voterPublicKey: voterPrivateKey.toPublicKey(),
            senderPublicKey: senderPrivateKey.toPublicKey(),
            treasuryOwnerPrivateKey: treasuryOwnerPrivateKey.toBase58(),
            treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
            fee,
            nonce,
            permissionType,
            vote,
          }
        );

        const tx = await Mina.transaction(
          {
            sender: senderPrivateKey.toPublicKey(),
            fee,
            nonce,
          },
          async () => {
            await treasuryOwner.vote(
              proposalPublicKey,
              // TODO: watch out, this account must exist otherwise the account creation fee must be paid
              voterPrivateKey.toPublicKey(),
              vote
            );

            if (permissionType == "signature") {
              treasuryOwner.self.requireSignature();
            }
          }
        );

        tx.sign(
          // if we're using signature permissions, we need to sign with the treasury owner private key
          permissionType == "signature"
            ? [
                senderPrivateKey,
                voterPrivateKey,
                treasuryOwnerPrivateKey,
                proposalPrivateKey,
              ]
            : [senderPrivateKey, voterPrivateKey]
        );

        if (permissionType == "proof") {
          console.time("prove");
          await tx.prove();
          console.timeEnd("prove");
        }

        Provable.log("sending transaction");
        Provable.log("tx", tx.toPretty());
        const pendingTx = await tx.send();
        Provable.log("waiting for transaction to be included", pendingTx.hash);
        const includedTx = await pendingTx.wait();
        Provable.log("Vote on proposal successful", includedTx);
      }
    );
}
