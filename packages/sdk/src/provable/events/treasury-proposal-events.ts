import { Field, PublicKey, Struct, UInt32, UInt64 } from "o1js";
import { Vote } from "../contracts/treasury-proposal/vote-reducer.js";

export const PROPOSAL_CREATED_EVENT_NAME = "proposalCreated" as const;
export const PROPOSAL_VOTE_DISPATCHED_EVENT_NAME =
  "proposalVoteDispatched" as const;

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
}) {}

/**
 * Owner-level vote dispatch event payload.
 */
export class ProposalVoteDispatchedEvent extends Struct({
  proposalPublicKey: PublicKey,
  voterPublicKey: PublicKey,
  vote: Vote,
}) {}
