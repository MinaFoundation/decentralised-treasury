import { ProposalExecutionEntity } from "./proposal-execution-entity.js";
import { ProposalEntity } from "./proposal-entity.js";
import { VoteEntity } from "./vote-entity.js";
import { VoteNullifierEntity } from "./vote-nullifier-entity.js";
import { VoteTallyEntity } from "./vote-tally-entity.js";

export const proposalProcessorOutputEntities = [
  ProposalEntity,
  ProposalExecutionEntity,
  VoteEntity,
  VoteNullifierEntity,
  VoteTallyEntity,
];
