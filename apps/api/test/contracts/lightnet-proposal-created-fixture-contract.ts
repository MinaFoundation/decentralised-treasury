import { Permissions, SmartContract, method } from "o1js";
import {
  PROPOSAL_CREATED_EVENT_NAME,
  ProposalCreatedEvent,
} from "@repo/sdk/src/provable/events/treasury-proposal-events.js";

export class LightnetProposalCreatedFixtureContract extends SmartContract {
  public events = {
    [PROPOSAL_CREATED_EVENT_NAME]: ProposalCreatedEvent,
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
