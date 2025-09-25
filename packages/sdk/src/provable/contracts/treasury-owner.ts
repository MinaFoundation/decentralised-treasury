import {
  AccountUpdate,
  AccountUpdateForest,
  Bool,
  Field,
  Permissions,
  Provable,
  PublicKey,
  State,
  Struct,
  TokenContract,
  UInt64,
  method,
  state,
} from "o1js";
import {
  SideLoadedVoteReducerProof,
  Vote,
} from "./treasury-proposal/vote-reducer.js";
import { TreasuryProposalSmartContract } from "./treasury-proposal/treasury-proposal.js";

export class Proposal extends Struct({
  amount: UInt64,
  recipient: PublicKey,
}) {}

// TODO: set correct starting permissions
export class TreasuryOwnerSmartContract extends TokenContract {
  public static proposalContractVerificationKey?: {
    data: string;
    hash: Field;
  };

  @method
  public async createProposal(proposal: Proposal) {
    const proposalUpdate = AccountUpdate.createSigned(
      proposal.recipient,
      this.deriveTokenId()
    );
    proposalUpdate.account.verificationKey.set(
      TreasuryProposalSmartContract._verificationKey
    );

    // TODO: make sure the permissions are sufficiently restrictive
    proposalUpdate.account.permissions.set(Permissions.default());
  }

  @method
  public async vote(
    proposalPublicKey: PublicKey,
    publicKey: PublicKey,
    vote: Vote
  ) {
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );
    await proposal.vote({
      vote,
      publicKey,
    });

    // TODO: this creates a new account if it doesnt exist, it'll cost 1 MINA
    // it could be free if we just check a hand crafted signature instead
    // this becomes relevant if a delegate public key is used that is not in the current L1 ledger
    AccountUpdate.createSigned(publicKey);

    this.approve(proposal.self);
  }

  @method
  public async tallyVotes(
    proposalPublicKey: PublicKey,
    voteTallyProof: SideLoadedVoteReducerProof
  ) {
    const proposal = new TreasuryProposalSmartContract(
      proposalPublicKey,
      this.deriveTokenId()
    );
    voteTallyProof.verify(
      TreasuryProposalSmartContract.voteReducerVerificationKey
    );
    await proposal.tallyVotes(voteTallyProof);

    this.approve(proposal.self);
  }

  public async approveBase(updates: AccountUpdateForest) {
    this.forEachUpdate(updates, (update, usesToken) => {
      usesToken.assertFalse(
        "No external account updates allowed for this token"
      );
    });
  }
}
