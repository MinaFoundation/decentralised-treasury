import { Command, Option } from "commander";
import {
  AccountUpdate,
  fetchAccount,
  Mina,
  Permissions,
  PrivateKey,
  Provable,
  UInt32,
  UInt64,
} from "o1js";
import { PublicKey } from "o1js";
import {
  LIFECYCLE_PERIOD_DURATION,
  TreasuryOwnerSmartContract,
} from "../provable/contracts/treasury-owner.js";
import { compileTreasuryContracts } from "./deploy-treasury-owner.js";
import { TreasuryProposalSmartContract } from "../provable/contracts/treasury-proposal/treasury-proposal.js";

export default function createProposalCommandFactory(program: Command) {
  program
    .command("create-proposal")
    .requiredOption(
      "--amount <amount>",
      "Amount of nano $MINA to transfer",
      (value) => UInt64.from(value)
    )
    // TODO: add a read-proposal command that reads the proposal content from the host and prints it to the console
    .addOption(
      new Option(
        "--proposal-content-host-type <proposal-content-host-type>",
        "Type of the proposal content host"
      )
        .choices(["github"])
        .default("github")
    )
    .requiredOption(
      "--proposal-content-identifier <proposal-content-identifier>",
      "Identifier of the proposal content"
    )
    .requiredOption(
      "--recipient-public-key <recipient-public-key>",
      "Recipient of the transfer",
      (value) => PublicKey.fromBase58(value)
    )
    .requiredOption(
      "--proposal-lifecycle-id <proposal-lifecycle-id>",
      "Lifecycle id of the proposal",
      (value) => UInt32.from(value)
    )
    .requiredOption(
      "--treasury-owner-public-key <treasury-owner-public-key>",
      "Public key of the treasury owner contract",
      (value) => PublicKey.fromBase58(value)
    )
    .option(
      "--treasury-owner-private-key <treasury-owner-private-key>",
      "Private key of the treasury owner contract",
      (value) => PrivateKey.fromBase58(value)
    )
    .requiredOption(
      "--proposal-private-key <proposal-private-key>",
      "Private key of the proposal",
      (value) => PrivateKey.fromBase58(value)
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
    .addOption(
      new Option(
        "--permission-type <permission-type>",
        "Set of permissions for interacting with the treasury owner"
      )
        .choices(["proof", "signature"])
        .default("proof")
    )
    .option(
      "--lifecycle-period-duration <lifecycle-period-duration>",
      "Duration of the lifecycle period",
      (value) => UInt32.from(value),
      LIFECYCLE_PERIOD_DURATION
    )
    .action(
      async ({
        amount,
        recipientPublicKey,
        minaNodeUrl,
        treasuryOwnerPublicKey,
        treasuryOwnerPrivateKey,
        proposalLifecycleId,
        proposalPrivateKey,
        proposalContentIdentifier,
        proposalContentHostType,
        senderPrivateKey,
        fee,
        nonce,
        memo,
        permissionType,
        lifecyclePeriodDuration,
      }: {
        amount: UInt64;
        recipientPublicKey: PublicKey;
        minaNodeUrl: string;
        treasuryOwnerPublicKey: PublicKey;
        treasuryOwnerPrivateKey: PrivateKey;
        proposalLifecycleId: UInt32;
        proposalPrivateKey: PrivateKey;
        proposalContentIdentifier: string;
        proposalContentHostType: string;
        senderPrivateKey: PrivateKey;
        fee: UInt64;
        nonce: number;
        memo: string;
        permissionType: "proof" | "signature";
        lifecyclePeriodDuration: UInt32;
      }) => {
        console.log(
          "Creating proposal",
          amount,
          recipientPublicKey,
          minaNodeUrl
        );

        TreasuryProposalSmartContract.permissionType = permissionType;

        await compileTreasuryContracts(lifecyclePeriodDuration);

        const Network = Mina.Network({
          mina: minaNodeUrl,
        });
        Mina.setActiveInstance(Network);

        const treasuryOwner = new TreasuryOwnerSmartContract(
          treasuryOwnerPublicKey
        );

        const zkAppUri = `${proposalContentHostType}://${proposalContentIdentifier}`;

        Provable.log("Creating proposal");
        await (async () => {
          const tx = await Mina.transaction(
            {
              sender: senderPrivateKey.toPublicKey(),
              fee,
              nonce,
              memo,
            },
            async () => {
              // const { account, error } = await fetchAccount({
              //   publicKey: proposalPrivateKey.toPublicKey(),
              // });

              // account does not exist yet, fund it, but
              // if (error) {
              AccountUpdate.fundNewAccount(senderPrivateKey.toPublicKey(), 1);
              // }

              await treasuryOwner.createProposal(
                proposalPrivateKey.toPublicKey(),
                {
                  amount,
                  recipient: recipientPublicKey,
                  zkAppUri,
                },
                UInt32.from(0)
              );

              if (permissionType == "signature") {
                treasuryOwner.self.requireSignature();
              }
            }
          );

          tx.sign(
            // if we're using signature permissions, we need to sign with the treasury owner private key
            permissionType == "signature"
              ? [senderPrivateKey, proposalPrivateKey, treasuryOwnerPrivateKey]
              : [senderPrivateKey, proposalPrivateKey]
          );

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
          Provable.log("Proposal creation successful", includedTx);
        })();

        // await fetchAccount({
        //   publicKey: proposalPrivateKey.toPublicKey(),
        // });

        // await fetchAccount({
        //   publicKey: treasuryOwnerPublicKey,
        // });

        // await fetchAccount({
        //   publicKey: senderPrivateKey.toPublicKey(),
        // });

        // Provable.log("Updating proposal");
        // await (async () => {
        //   const tx = await Mina.transaction(
        //     {
        //       sender: senderPrivateKey.toPublicKey(),
        //       fee,
        //       nonce,
        //       memo,
        //     },
        //     async () => {
        //       await treasuryOwner.updateProposal(
        //         proposalPrivateKey.toPublicKey(),
        //         {
        //           amount,
        //           recipient: recipientPublicKey,
        //           zkAppUri,
        //         }
        //       );

        //       if (permissionType == "signature") {
        //         treasuryOwner.self.requireSignature();
        //       }
        //     }
        //   );

        //   tx.sign(
        //     // if we're using signature permissions, we need to sign with the treasury owner private key
        //     permissionType == "signature"
        //       ? [senderPrivateKey, proposalPrivateKey, treasuryOwnerPrivateKey]
        //       : [senderPrivateKey, proposalPrivateKey]
        //   );

        //   if (permissionType == "proof") {
        //     console.time("prove");
        //     await tx.prove();
        //     console.timeEnd("prove");
        //   }

        //   Provable.log("sending transaction");
        //   Provable.log("tx", tx.toPretty());
        //   const pendingTx = await tx.send();
        //   Provable.log(
        //     "waiting for transaction to be included",
        //     pendingTx.hash
        //   );
        //   const includedTx = await pendingTx.wait();
        //   Provable.log("Proposal update successful", includedTx);
        // })();
      }
    );
}
