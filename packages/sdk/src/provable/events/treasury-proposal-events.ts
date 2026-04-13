import { Bool, Field, PublicKey, Struct, UInt32, UInt64 } from "o1js";
import { Vote } from "../contracts/treasury-proposal/vote-reducer.js";

export const PROPOSAL_CREATED_EVENT_NAME = "proposalCreated" as const;
export const PROPOSAL_VOTE_DISPATCHED_EVENT_NAME =
  "proposalVoteDispatched" as const;
export const PROPOSAL_VOTES_TALLIED_EVENT_NAME =
  "proposalVotesTallied" as const;
export const PROPOSAL_EXECUTED_EVENT_NAME = "proposalExecuted" as const;
export const PROPOSAL_PAUSE_TOGGLED_EVENT_NAME = "proposalPauseToggled" as const;

/**
 * Owner-level proposal creation event payload.
 * Kept in a shared module so both production and mock/indexer-fixture contracts
 * can emit the exact same schema.
 */
export class ProposalCreatedEvent extends Struct({
  proposalPublicKey: PublicKey,
  lifecycleId: UInt32,
  amount: UInt64,
  recipient: PublicKey,
  zkAppUriHash: Field,
  stakingEpochDataLedgerHash: Field,
  stakingEpochDataLedgerTotalCurrency: UInt64,
  proposerPublicKey: PublicKey,
  senderPublicKey: PublicKey,
}) {}

/**
 * Owner-level vote dispatch event payload.
 */
export class ProposalVoteDispatchedEvent extends Struct({
  proposalPublicKey: PublicKey,
  voterPublicKey: PublicKey,
  vote: Vote,
  senderPublicKey: PublicKey,
}) {}

/**
 * Owner-level tally result event payload.
 */
export class ProposalVotesTalliedEvent extends Struct({
  proposalPublicKey: PublicKey,
  lifecycleId: UInt32,
  yayWeight: UInt64,
  nayWeight: UInt64,
  abstainWeight: UInt64,
  voteResult: Field,
  senderPublicKey: PublicKey,
}) {}

/**
 * Owner-level execution event payload.
 */
export class ProposalExecutedEvent extends Struct({
  proposalPublicKey: PublicKey,
  amountToPayOut: UInt64,
  senderPublicKey: PublicKey,
}) {}

/**
 * Owner-level pause toggle payload.
 */
export class ProposalPauseToggledEvent extends Struct({
  proposalPublicKey: PublicKey,
  paused: Bool,
  senderPublicKey: PublicKey,
}) {}
