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

export interface CompileProposalContractsRequest {
  id: string;
  type: "compile";
  proofsEnabled: boolean;
}

export interface ProveTransactionJsonRequest {
  id: string;
  type: "proveTransactionJson";
  transactionJson: string;
  proofsEnabled: boolean;
}

export interface BuildAndProveCreateProposalRequest {
  id: string;
  type: "buildAndProveCreateProposal";
  input: PrepareCreateProposalTransactionInput;
  proofsEnabled: boolean;
}

export interface BuildAndProveVoteProposalRequest {
  id: string;
  type: "buildAndProveVoteProposal";
  input: PrepareVoteProposalTransactionInput;
  proofsEnabled: boolean;
}

export interface BuildAndProveExecuteProposalRequest {
  id: string;
  type: "buildAndProveExecuteProposal";
  input: PrepareExecuteProposalTransactionInput;
  proofsEnabled: boolean;
}

export interface GetProposalProverStatusRequest {
  id: string;
  type: "getStatus";
}

export type ProposalProverWorkerRequest =
  | CompileProposalContractsRequest
  | ProveTransactionJsonRequest
  | BuildAndProveCreateProposalRequest
  | BuildAndProveVoteProposalRequest
  | BuildAndProveExecuteProposalRequest
  | GetProposalProverStatusRequest;

export type ProposalProverWorkerRequestWithoutId =
  | Omit<CompileProposalContractsRequest, "id">
  | Omit<ProveTransactionJsonRequest, "id">
  | Omit<BuildAndProveCreateProposalRequest, "id">
  | Omit<BuildAndProveVoteProposalRequest, "id">
  | Omit<BuildAndProveExecuteProposalRequest, "id">
  | Omit<GetProposalProverStatusRequest, "id">;

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
