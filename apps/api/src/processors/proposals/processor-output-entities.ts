import { ProposalExecutionEntity } from "./proposal-execution-entity.js";
import { ProposalContentEntity } from "./proposal-content-entity.js";
import { ProposalEventFactEntity } from "./proposal-event-fact-entity.js";
import { ProposalEntity } from "./proposal-entity.js";
import { ProposalProjectionReplayEntity } from "./proposal-projection-replay-entity.js";
import { VoteEntity } from "./vote-entity.js";
import { VoteNullifierEntity } from "./vote-nullifier-entity.js";
import { VoteTallyEntity } from "./vote-tally-entity.js";

export const proposalProcessorOutputEntities = [
  ProposalEntity,
  ProposalContentEntity,
  ProposalExecutionEntity,
  ProposalEventFactEntity,
  ProposalProjectionReplayEntity,
  VoteEntity,
  VoteNullifierEntity,
  VoteTallyEntity,
];
