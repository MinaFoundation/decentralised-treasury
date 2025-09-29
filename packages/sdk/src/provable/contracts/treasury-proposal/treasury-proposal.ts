import {
  Bool,
  Field,
  method,
  Reducer,
  SmartContract,
  State,
  state,
  Struct,
  PublicKey,
  Provable,
  VerificationKey,
  UInt64,
} from "o1js";
import { SideLoadedVoteReducerProof, VoteAction } from "./vote-reducer.js";

// TODO: set correct starting permissions
export class TreasuryProposalSmartContract extends SmartContract {
  public static voteReducerVerificationKey: VerificationKey;
  reducer = Reducer({ actionType: VoteAction });

  @state(PublicKey) recipient = State<PublicKey>();

  @state(UInt64) lifecycleId = State<UInt64>();

  @state(Field) stakingEpochDataLedgerHash = State<Field>();
  @state(UInt64) stakingEpochDataLedgerTotalCurrency = State<UInt64>();

  @method
  public async vote(voteAction: VoteAction) {
    this.reducer.dispatch(voteAction);
  }

  @method
  public async tallyVotes(voteReducerProof: SideLoadedVoteReducerProof) {
    voteReducerProof.verify(
      TreasuryProposalSmartContract.voteReducerVerificationKey
    );
    // TODO: add logic such as if the current period allows for vote tallying
    const actionState = this.account.actionState.getAndRequireEquals();

    // TODO: is this already the historical 5 "slot" action hash precondition?
    actionState.assertEquals(
      voteReducerProof.publicOutput.toActionsHash,
      "toActionsHash does not match on chain state"
    );
  }

  // TODO
  @method
  public async execute() {}
}
