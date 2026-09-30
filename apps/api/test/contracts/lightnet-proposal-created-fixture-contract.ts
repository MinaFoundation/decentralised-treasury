import { Permissions, SmartContract, method } from "o1js";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
  ProposalCreatedEvent,
  ProposalExecutedEvent,
  ProposalPauseToggledEvent,
  ProposalVoteDispatchedEvent,
  ProposalVotesTalliedEvent,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";

export class LightnetProposalCreatedFixtureContract extends SmartContract {
  public events = {
    // Match the Owner schema: o1js omits the discriminator for a single event.
    [PROPOSAL_CREATED_EVENT_NAME]: ProposalCreatedEvent,
    [PROPOSAL_EXECUTED_EVENT_NAME]: ProposalExecutedEvent,
    [PROPOSAL_PAUSE_TOGGLED_EVENT_NAME]: ProposalPauseToggledEvent,
    [PROPOSAL_VOTE_DISPATCHED_EVENT_NAME]: ProposalVoteDispatchedEvent,
    [PROPOSAL_VOTES_TALLIED_EVENT_NAME]: ProposalVotesTalliedEvent,
  };

  public override async deploy(): Promise<void> {
    await super.deploy();
    this.account.permissions.set({
      ...Permissions.allImpossible(),
      access: Permissions.proofOrSignature(),
      editState: Permissions.proofOrSignature(),
      incrementNonce: Permissions.proofOrSignature(),
      send: Permissions.proofOrSignature(),
      receive: Permissions.proofOrSignature(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
    });
  }

  @method
  public async emitProposalCreated(event: ProposalCreatedEvent): Promise<void> {
    this.self.requireSignature();
    this.emitEvent(PROPOSAL_CREATED_EVENT_NAME, event);
  }
}
