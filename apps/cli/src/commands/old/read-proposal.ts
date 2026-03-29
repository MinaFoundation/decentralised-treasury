import { Command } from "commander";
import { fetchAccount, Mina, Provable, PublicKey } from "o1js";
import { TreasuryOwnerSmartContract } from "@repo/sdk/src/provable/contracts/treasury-owner.js";
import {
  ProposalStatus,
  TreasuryProposalSmartContract,
} from "@repo/sdk/src/provable/contracts/treasury-proposal/treasury-proposal.js";

export default function readProposalCommandFactory(program: Command) {
  program
    .command("read-proposal")
    .requiredOption(
      "--treasury-owner-public-key <treasury-owner-public-key>",
      "Treasury owner public key",
      (value) => PublicKey.fromBase58(value)
    )
    .requiredOption(
      "--proposal-public-key <proposal-public-key>",
      "Proposal public key",
      (value) => PublicKey.fromBase58(value)
    )
    .requiredOption("--mina-node-url <mina-node-url>", "Mina node URL")
    .action(
      async ({
        treasuryOwnerPublicKey,
        proposalPublicKey,
        minaNodeUrl,
      }: {
        treasuryOwnerPublicKey: PublicKey;
        proposalPublicKey: PublicKey;
        minaNodeUrl: string;
      }) => {
        const treasuryOwner = new TreasuryOwnerSmartContract(
          treasuryOwnerPublicKey
        );
        const proposal = new TreasuryProposalSmartContract(
          proposalPublicKey,
          treasuryOwner.deriveTokenId()
        );

        Mina.setActiveInstance(Mina.Network({ mina: minaNodeUrl }));
        const { account, error } = await fetchAccount({
          publicKey: proposalPublicKey,
          tokenId: treasuryOwner.deriveTokenId(),
        });

        if (error) {
          console.error("Error fetching proposal account", error);
          // TODO: fix async errors not handled well in commander
          throw error;
        }

        // TODO: need a better delimiter for the host type
        const proposalHostType = account.zkapp.zkappUri.split("://")[0];
        const proposalContentIdentifier = account.zkapp.zkappUri
          .split("://")
          .slice(1)
          .join("://");

        Provable.log("Recipient:", await proposal.recipient.fetch());
        Provable.log("Amount:", await proposal.amount.fetch());
        Provable.log("Lifecycle ID:", await proposal.lifecycleId.fetch());
        Provable.log(
          "Staking Epoch Data Ledger Hash:",
          await proposal.stakingEpochDataLedgerHash.fetch()
        );
        Provable.log(
          "Staking Epoch Data Ledger Total Currency:",
          await proposal.stakingEpochDataLedgerTotalCurrency.fetch()
        );
        const status = await (async () => {
          switch ((await proposal.status.fetch()).toBigInt()) {
            case ProposalStatus.UNKNOWN.toBigInt():
              return "Unknown / Pending";
            case ProposalStatus.APPROVED.toBigInt():
              return "Approved";
            case ProposalStatus.REJECTED.toBigInt():
              return "Rejected";
            case ProposalStatus.PAUSED.toBigInt():
              return "Paused";
          }
        })();
        Provable.log("Status:", status);
        Provable.log("Paid Out Amount:", await proposal.paidOutAmount.fetch());

        console.log("\nContent:");
        switch (proposalHostType) {
          case "github":
            const response = await fetch(proposalContentIdentifier);
            if (!response.ok) {
              throw new Error(
                `Failed to fetch proposal content: ${response.statusText}`
              );
            }
            const proposalContent = await response.text();
            Provable.log(proposalContent);
            break;
          default:
            throw new Error(
              `Unsupported proposal host type: ${proposalHostType}`
            );
        }
      }
    );
}
