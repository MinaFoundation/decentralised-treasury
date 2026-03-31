import assert from "node:assert";
import { it } from "node:test";
import {
  Field,
  method,
  PrivateKey,
  SmartContract,
  UInt32,
  UInt64,
} from "o1js";
import {
  ProposalCreatedEvent,
  PROPOSAL_CREATED_EVENT_NAME,
} from "../../../src/provable/events/treasury-proposal-events.js";

class MockIndexerFixtureContract extends SmartContract {
  events = {
    [PROPOSAL_CREATED_EVENT_NAME]: ProposalCreatedEvent,
  };

  @method
  public async emitProposalCreated(event: ProposalCreatedEvent) {
    this.emitEvent(PROPOSAL_CREATED_EVENT_NAME, event);
  }
}

it("reuses ProposalCreated event schema in mock contracts", async () => {
  const analysis = await MockIndexerFixtureContract.analyzeMethods();
  assert(
    "emitProposalCreated" in analysis,
    "expected mock contract to expose emitProposalCreated method",
  );

  const payload = new ProposalCreatedEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    lifecycleId: UInt32.from(0),
    amount: UInt64.from(1000),
    recipient: PrivateKey.random().toPublicKey(),
    zkAppUriHash: Field(123),
  });

  const fields = ProposalCreatedEvent.toFields(payload);
  const decoded = ProposalCreatedEvent.fromFields(fields);

  assert(
    decoded.proposalPublicKey.equals(payload.proposalPublicKey).toBoolean(),
    "proposalPublicKey mismatch after encoding roundtrip",
  );
  assert(
    decoded.lifecycleId.equals(payload.lifecycleId).toBoolean(),
    "lifecycleId mismatch after encoding roundtrip",
  );
  assert(
    decoded.amount.equals(payload.amount).toBoolean(),
    "amount mismatch after encoding roundtrip",
  );
  assert(
    decoded.recipient.equals(payload.recipient).toBoolean(),
    "recipient mismatch after encoding roundtrip",
  );
  assert(
    decoded.zkAppUriHash.equals(payload.zkAppUriHash).toBoolean(),
    "zkAppUriHash mismatch after encoding roundtrip",
  );
});
