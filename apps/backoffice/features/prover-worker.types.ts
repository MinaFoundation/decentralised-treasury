import type { OperationPackage } from "./operations";
import type { BackofficeRuntimeConfig } from "./runtime-config";

export type ProverPhase = "idle" | "compiling" | "proving";

export interface ProverStatus {
  ready: boolean;
  phase: ProverPhase;
  error: string | null;
}

interface RequestEnvelope {
  id: string;
  config: BackofficeRuntimeConfig;
}

export type ProverRequest =
  | (RequestEnvelope & { type: "status" })
  | (RequestEnvelope & { type: "compile"; includeProposalContracts: boolean })
  | (RequestEnvelope & {
      type: "buildAndProve";
      operation: OperationPackage;
      senderAddress: string;
      fee: string;
      memo: string;
    });

export type ProverRequestInput =
  | { type: "status" }
  | { type: "compile"; includeProposalContracts: boolean }
  | {
      type: "buildAndProve";
      operation: OperationPackage;
      senderAddress: string;
      fee: string;
      memo: string;
    };

export type ProverResponse =
  | {
      id: string;
      ok: true;
      status: ProverStatus;
      transactionJson?: string;
    }
  | { id: string; ok: false; status: ProverStatus; error: string };
