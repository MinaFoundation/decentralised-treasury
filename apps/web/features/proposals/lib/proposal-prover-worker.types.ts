import type { TreasuryRuntimeConfig } from "../../runtime-config/lib/runtime-config.types";
import type {
  PreparedCreateProposalTransaction,
  PreparedExecuteProposalTransaction,
  PreparedVoteProposalTransaction,
  PrepareCreateProposalTransactionInput,
  PrepareExecuteProposalTransactionInput,
  PrepareVoteProposalTransactionInput,
  SerializedProposalCompileArtifacts,
} from "./proposal-prover-runtime";

export type ProposalProverWorkerPhase = "idle" | "compiling" | "proving";

export interface ProposalProverWorkerStatus {
  ready: boolean;
  phase: ProposalProverWorkerPhase;
  error: string | null;
}

/**
 * The envelope every request carries.
 *
 * `runtimeConfig` rides along on each message rather than being sent once at
 * worker startup. A worker has its own global scope, so the bootstrap script
 * the server renders into the document never runs there; carrying the config
 * per message keeps the worker correct without depending on message ordering
 * or on state surviving a worker restart.
 */
export interface ProposalProverWorkerRequestEnvelope {
  id: string;
  runtimeConfig: TreasuryRuntimeConfig;
}

export interface CompileProposalContractsRequest
  extends ProposalProverWorkerRequestEnvelope {
  type: "compile";
  proofsEnabled: boolean;
}

export interface ProveTransactionJsonRequest
  extends ProposalProverWorkerRequestEnvelope {
  type: "proveTransactionJson";
  transactionJson: string;
  proofsEnabled: boolean;
}

export interface BuildAndProveCreateProposalRequest
  extends ProposalProverWorkerRequestEnvelope {
  type: "buildAndProveCreateProposal";
  input: PrepareCreateProposalTransactionInput;
  proofsEnabled: boolean;
}

export interface BuildAndProveVoteProposalRequest
  extends ProposalProverWorkerRequestEnvelope {
  type: "buildAndProveVoteProposal";
  input: PrepareVoteProposalTransactionInput;
  proofsEnabled: boolean;
}

export interface BuildAndProveExecuteProposalRequest
  extends ProposalProverWorkerRequestEnvelope {
  type: "buildAndProveExecuteProposal";
  input: PrepareExecuteProposalTransactionInput;
  proofsEnabled: boolean;
}

export interface GetProposalProverStatusRequest
  extends ProposalProverWorkerRequestEnvelope {
  type: "getStatus";
}

export type ProposalProverWorkerRequest =
  | CompileProposalContractsRequest
  | ProveTransactionJsonRequest
  | BuildAndProveCreateProposalRequest
  | BuildAndProveVoteProposalRequest
  | BuildAndProveExecuteProposalRequest
  | GetProposalProverStatusRequest;

type WithoutEnvelope<Request extends ProposalProverWorkerRequestEnvelope> =
  Omit<Request, keyof ProposalProverWorkerRequestEnvelope>;

/**
 * What a caller passes to `sendRequest`; the hook fills in the envelope.
 */
export type ProposalProverWorkerRequestInput =
  | WithoutEnvelope<CompileProposalContractsRequest>
  | WithoutEnvelope<ProveTransactionJsonRequest>
  | WithoutEnvelope<BuildAndProveCreateProposalRequest>
  | WithoutEnvelope<BuildAndProveVoteProposalRequest>
  | WithoutEnvelope<BuildAndProveExecuteProposalRequest>
  | WithoutEnvelope<GetProposalProverStatusRequest>;

export interface ProposalProverWorkerSuccessResponse {
  id: string;
  ok: true;
  status: ProposalProverWorkerStatus;
  compileArtifacts?: SerializedProposalCompileArtifacts;
  transactionJson?: string;
  preparedCreateProposalTransaction?: PreparedCreateProposalTransaction;
  preparedVoteProposalTransaction?: PreparedVoteProposalTransaction;
  preparedExecuteProposalTransaction?: PreparedExecuteProposalTransaction;
}

export interface ProposalProverWorkerErrorResponse {
  id: string;
  ok: false;
  error: string;
  status: ProposalProverWorkerStatus;
}

export type ProposalProverWorkerResponse =
  | ProposalProverWorkerSuccessResponse
  | ProposalProverWorkerErrorResponse;
