import assert from "node:assert";
import { it } from "node:test";
import {
  Bool,
  Field,
  method,
  PrivateKey,
  SmartContract,
  UInt32,
  UInt64,
} from "o1js";
import {
  ProposalExecutedEvent,
  ProposalPauseToggledEvent,
  ProposalCreatedEvent,
  ProposalVoteDispatchedEvent,
  ProposalVotesTalliedEvent,
  PROPOSAL_EXECUTED_EVENT_NAME,
  PROPOSAL_PAUSE_TOGGLED_EVENT_NAME,
  PROPOSAL_CREATED_EVENT_NAME,
  PROPOSAL_VOTE_DISPATCHED_EVENT_NAME,
  PROPOSAL_VOTES_TALLIED_EVENT_NAME,
} from "../../../src/provable/events/treasury-proposal-events.js";
import { Vote } from "../../../src/provable/contracts/treasury-proposal/vote-reducer.js";

class MockIndexerFixtureContract extends SmartContract {
  events = {
    [PROPOSAL_CREATED_EVENT_NAME]: ProposalCreatedEvent,
    [PROPOSAL_VOTE_DISPATCHED_EVENT_NAME]: ProposalVoteDispatchedEvent,
    [PROPOSAL_VOTES_TALLIED_EVENT_NAME]: ProposalVotesTalliedEvent,
    [PROPOSAL_EXECUTED_EVENT_NAME]: ProposalExecutedEvent,
    [PROPOSAL_PAUSE_TOGGLED_EVENT_NAME]: ProposalPauseToggledEvent,
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
    stakingEpochDataLedgerHash: Field(456),
    stakingEpochDataLedgerTotalCurrency: UInt64.from(789),
    proposerPublicKey: PrivateKey.random().toPublicKey(),
    senderPublicKey: PrivateKey.random().toPublicKey(),
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
  assert(
    decoded.stakingEpochDataLedgerHash
      .equals(payload.stakingEpochDataLedgerHash)
      .toBoolean(),
    "stakingEpochDataLedgerHash mismatch after encoding roundtrip",
  );
  assert(
    decoded.stakingEpochDataLedgerTotalCurrency
      .equals(payload.stakingEpochDataLedgerTotalCurrency)
      .toBoolean(),
    "stakingEpochDataLedgerTotalCurrency mismatch after encoding roundtrip",
  );
  assert(
    decoded.proposerPublicKey.equals(payload.proposerPublicKey).toBoolean(),
    "proposerPublicKey mismatch after encoding roundtrip",
  );
  assert(
    decoded.senderPublicKey.equals(payload.senderPublicKey).toBoolean(),
    "senderPublicKey mismatch after encoding roundtrip",
  );
});

it("reuses ProposalVoteDispatched event schema in mock contracts", async () => {
  const payload = new ProposalVoteDispatchedEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    voterPublicKey: PrivateKey.random().toPublicKey(),
    vote: Vote.YAY,
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });

  const decoded = ProposalVoteDispatchedEvent.fromFields(
    ProposalVoteDispatchedEvent.toFields(payload),
  );
  assert(
    decoded.proposalPublicKey.equals(payload.proposalPublicKey).toBoolean(),
    "proposalPublicKey mismatch after vote dispatch encoding roundtrip",
  );
  assert(
    decoded.voterPublicKey.equals(payload.voterPublicKey).toBoolean(),
    "voterPublicKey mismatch after vote dispatch encoding roundtrip",
  );
  assert.equal(decoded.vote.toBigInt(), payload.vote.toBigInt());
  assert(
    decoded.senderPublicKey.equals(payload.senderPublicKey).toBoolean(),
    "senderPublicKey mismatch after vote dispatch encoding roundtrip",
  );
});

it("reuses ProposalVotesTallied event schema in mock contracts", async () => {
  const payload = new ProposalVotesTalliedEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    lifecycleId: UInt32.from(1),
    yayWeight: UInt64.from(400),
    nayWeight: UInt64.from(100),
    abstainWeight: UInt64.from(50),
    voteResult: Field(1),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });

  const decoded = ProposalVotesTalliedEvent.fromFields(
    ProposalVotesTalliedEvent.toFields(payload),
  );
  assert(
    decoded.proposalPublicKey.equals(payload.proposalPublicKey).toBoolean(),
    "proposalPublicKey mismatch after tally encoding roundtrip",
  );
  assert(
    decoded.abstainWeight
      .equals(payload.abstainWeight)
      .toBoolean(),
    "abstainWeight mismatch after tally encoding roundtrip",
  );
  assert(
    decoded.voteResult.equals(payload.voteResult).toBoolean(),
    "voteResult mismatch after tally encoding roundtrip",
  );
  assert(
    decoded.senderPublicKey.equals(payload.senderPublicKey).toBoolean(),
    "senderPublicKey mismatch after tally encoding roundtrip",
  );
});

it("reuses ProposalExecuted event schema in mock contracts", async () => {
  const payload = new ProposalExecutedEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    amountToPayOut: UInt64.from(250),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });

  const decoded = ProposalExecutedEvent.fromFields(
    ProposalExecutedEvent.toFields(payload),
  );
  assert(
    decoded.proposalPublicKey.equals(payload.proposalPublicKey).toBoolean(),
    "proposalPublicKey mismatch after execute encoding roundtrip",
  );
  assert(
    decoded.amountToPayOut.equals(payload.amountToPayOut).toBoolean(),
    "amountToPayOut mismatch after execute encoding roundtrip",
  );
  assert(
    decoded.senderPublicKey.equals(payload.senderPublicKey).toBoolean(),
    "senderPublicKey mismatch after execute encoding roundtrip",
  );
});

it("reuses ProposalPauseToggled event schema in mock contracts", async () => {
  const payload = new ProposalPauseToggledEvent({
    proposalPublicKey: PrivateKey.random().toPublicKey(),
    paused: Bool(true),
    senderPublicKey: PrivateKey.random().toPublicKey(),
  });

  const decoded = ProposalPauseToggledEvent.fromFields(
    ProposalPauseToggledEvent.toFields(payload),
  );
  assert(
    decoded.proposalPublicKey.equals(payload.proposalPublicKey).toBoolean(),
    "proposalPublicKey mismatch after pause toggle encoding roundtrip",
  );
  assert.equal(
    decoded.paused.toBoolean(),
    payload.paused.toBoolean(),
    "paused mismatch after pause toggle encoding roundtrip",
  );
  assert(
    decoded.senderPublicKey.equals(payload.senderPublicKey).toBoolean(),
    "senderPublicKey mismatch after pause toggle encoding roundtrip",
  );
});
