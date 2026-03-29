import { Command } from "commander";
import {
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  UInt32,
  AccountUpdate,
  Provable,
  fetchAccount,
} from "o1js";
import { TreasuryProposalSmartContract } from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";
import { compileTreasuryContracts } from "./deploy-treasury-owner.js";
import {
  LIFECYCLE_PERIOD_DURATION,
  TreasuryOwnerSmartContract,
} from "@repo/sdk/src/provable/contracts/treasury-owner.js";

export default function executeProposalCommandFactory(program: Command) {
  program
    .command("execute-proposal")
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
      "Proposal public key",
      (value) => PublicKey.fromBase58(value)
    )
    .option(
      "--proposal-private-key <proposal-private-key>",
      "Proposal private key",
      (value) => PrivateKey.fromBase58(value)
    )
    .requiredOption(
      "--mina-node-url <mina-node-url>",
      "Mina node URL",
      (value) => String(value)
    )
    .option(
      "--permission-type <permission-type>",
      "Permission type",
      (value) => value as "proof" | "signature",
      "proof"
    )
    .requiredOption(
      "--sender-private-key <sender-private-key>",
      "Sender private key",
      (value) => PrivateKey.fromBase58(value)
    )
    .option(
      "--fee <fee>",
      "Fee",
      (value) => UInt64.from(value),
      UInt64.from(1 * 10 ** 9)
    )
    .option(
      "--lifecycle-period-duration <lifecycle-period-duration>",
      "Lifecycle period duration",
      (value) => UInt32.from(value),
      LIFECYCLE_PERIOD_DURATION
    )
    .option("--nonce <nonce>", "Nonce", (value) => parseInt(value))
    .action(
      async ({
        treasuryOwnerPublicKey,
        treasuryOwnerPrivateKey,
        proposalPublicKey,
        proposalPrivateKey,
        minaNodeUrl,
        permissionType,
        senderPrivateKey,
        fee,
        nonce,
        lifecyclePeriodDuration,
      }) => {
        TreasuryProposalSmartContract.permissionType = permissionType;

        await compileTreasuryContracts(lifecyclePeriodDuration);

        const Network = Mina.Network({
          mina: minaNodeUrl,
        });
        Mina.setActiveInstance(Network);

        const treasuryOwner = new TreasuryOwnerSmartContract(
          treasuryOwnerPublicKey
        );

        const proposal = new TreasuryProposalSmartContract(
          proposalPublicKey,
          treasuryOwner.deriveTokenId()
        );

        Provable.log("executing proposal", {
          proposalPublicKey: proposalPublicKey.toBase58(),
          treasuryOwnerPublicKey: treasuryOwnerPublicKey.toBase58(),
          recipient: await proposal.recipient.fetch(),
          amount: await proposal.amount.fetch(),
          lifecycleId: await proposal.lifecycleId.fetch(),
          stakingEpochDataLedgerHash:
            await proposal.stakingEpochDataLedgerHash.fetch(),
          stakingEpochDataLedgerTotalCurrency:
            await proposal.stakingEpochDataLedgerTotalCurrency.fetch(),
          fee,
          nonce,
          permissionType,
        });

        const tx = await Mina.transaction(
          {
            sender: senderPrivateKey.toPublicKey(),
            fee,
            nonce,
          },
          async () => {
            // fund the recipient account creation
            const { error } = await fetchAccount({
              publicKey: await proposal.recipient.fetch(),
            });

            if (error) {
              AccountUpdate.fundNewAccount(senderPrivateKey.toPublicKey(), 1);
            }

            await treasuryOwner.executeProposal(proposalPublicKey);

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
        Provable.log("Execute proposal successful", includedTx);
      }
    );
}
