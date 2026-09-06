"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PreparedCreateProposalTransaction,
  PreparedExecuteProposalTransaction,
  PreparedVoteProposalTransaction,
  PrepareCreateProposalTransactionInput,
  PrepareExecuteProposalTransactionInput,
  PrepareVoteProposalTransactionInput,
  SerializedProposalCompileArtifacts,
} from "../lib/proposal-prover-runtime";
import { getRuntimeConfig } from "../../runtime-config/lib/get-runtime-config";
import type {
  ProposalProverWorkerRequest,
  ProposalProverWorkerRequestInput,
  ProposalProverWorkerResponse,
  ProposalProverWorkerStatus,
} from "../lib/proposal-prover-worker.types";

interface PendingRequestHandlers {
  resolve: (value: ProposalProverWorkerResponse) => void;
  reject: (error: Error) => void;
  cleanup?: () => void;
}

function toWorkerError(
  error: unknown,
  fallbackMessage = "Proposal prover worker failed.",
): Error {
  if (error instanceof Error) {
    return error.message.trim() ? error : new Error(fallbackMessage);
  }
  if (typeof error === "string") {
    const message = error.trim();
    return new Error(message || fallbackMessage);
  }
  return new Error(fallbackMessage);
}

const INITIAL_STATUS: ProposalProverWorkerStatus = {
  ready: false,
  phase: "idle",
  error: null,
};

export function useProposalProverWorker(proofsEnabled: boolean) {
  const workerRef = useRef<Worker | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingRequestHandlers>>(
    new Map(),
  );
  const [status, setStatus] =
    useState<ProposalProverWorkerStatus>(INITIAL_STATUS);
  const [compileArtifacts, setCompileArtifacts] =
    useState<SerializedProposalCompileArtifacts | null>(null);
  const [workerGeneration, setWorkerGeneration] = useState(0);

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/treasury-proposal.worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ProposalProverWorkerResponse>) => {
      const response = event.data;
      console.info("[proposal-prover][main] worker response", {
        id: response.id,
        ok: response.ok,
        phase: response.status.phase,
        ready: response.status.ready,
        hasCompileArtifacts: response.ok
          ? Boolean(response.compileArtifacts)
          : false,
        hasPreparedCreateProposalTransaction: response.ok
          ? Boolean(response.preparedCreateProposalTransaction)
          : false,
        hasPreparedVoteProposalTransaction: response.ok
          ? Boolean(response.preparedVoteProposalTransaction)
          : false,
        hasPreparedExecuteProposalTransaction: response.ok
          ? Boolean(response.preparedExecuteProposalTransaction)
          : false,
        transactionJsonType: response.ok
          ? typeof response.transactionJson
          : undefined,
        transactionJsonLength:
          response.ok && typeof response.transactionJson === "string"
            ? response.transactionJson.length
            : undefined,
      });
      setStatus(response.status);
      if (response.ok && response.compileArtifacts) {
        setCompileArtifacts(response.compileArtifacts);
      }
      const pending = pendingRequestsRef.current.get(response.id);
      if (!pending) {
        return;
      }
      pendingRequestsRef.current.delete(response.id);
      pending.cleanup?.();
      if (response.ok) {
        pending.resolve(response);
        return;
      }
      pending.reject(
        toWorkerError(
          response.error,
          "Proposal prover worker returned an unknown error.",
        ),
      );
    };

    worker.onerror = (event) => {
      const message = event.message || "Proposal prover worker crashed.";
      console.error("[proposal-prover][main] worker crashed", {
        message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
      setStatus((current) => ({
        ...current,
        phase: "idle",
        error: message,
      }));
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      for (const pending of pendingRequestsRef.current.values()) {
        pending.cleanup?.();
        pending.reject(new Error("Proposal prover worker was terminated."));
      }
      pendingRequestsRef.current.clear();
    };
  }, [workerGeneration]);

  const sendRequest = useCallback(
    (
      request: ProposalProverWorkerRequestInput,
      signal?: AbortSignal,
    ): Promise<ProposalProverWorkerResponse> => {
      if (signal?.aborted) {
        return Promise.reject(
          signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
      }
      const worker = workerRef.current;
      if (!worker) {
        return Promise.reject(
          new Error("Proposal prover worker is not available."),
        );
      }

      const id = crypto.randomUUID();
      // The worker's global scope never saw the page's bootstrap script, so it
      // cannot resolve configuration on its own - hand it ours with every
      // message. Read per request rather than captured once, so a config the
      // page updates is picked up without recreating the worker.
      const message = {
        ...request,
        id,
        runtimeConfig: getRuntimeConfig(),
      } as ProposalProverWorkerRequest;

      return new Promise((resolve, reject) => {
        const handleAbort = () => {
          if (!pendingRequestsRef.current.has(id)) {
            return;
          }
          const abortError =
            signal?.reason instanceof Error
              ? signal.reason
              : new DOMException("Aborted", "AbortError");
          workerRef.current?.terminate();
          workerRef.current = null;
          for (const pending of pendingRequestsRef.current.values()) {
            pending.cleanup?.();
            pending.reject(abortError);
          }
          pendingRequestsRef.current.clear();
          setStatus(INITIAL_STATUS);
          setCompileArtifacts(null);
          setWorkerGeneration((current) => current + 1);
        };
        signal?.addEventListener("abort", handleAbort, { once: true });
        pendingRequestsRef.current.set(id, {
          resolve,
          reject,
          cleanup: () => signal?.removeEventListener("abort", handleAbort),
        });
        console.info("[proposal-prover][main] posting worker request", {
          id,
          type: request.type,
          proofsEnabled:
            "proofsEnabled" in request ? request.proofsEnabled : undefined,
          hasCreateProposalInput:
            request.type === "buildAndProveCreateProposal" ||
            request.type === "buildAndProveVoteProposal" ||
            request.type === "buildAndProveExecuteProposal"
              ? Boolean(request.input)
              : undefined,
          transactionJsonType:
            request.type === "proveTransactionJson"
              ? typeof request.transactionJson
              : undefined,
          transactionJsonLength:
            request.type === "proveTransactionJson" &&
            typeof request.transactionJson === "string"
              ? request.transactionJson.length
              : undefined,
        });
        try {
          worker.postMessage(message);
        } catch (error) {
          console.error("[proposal-prover][main] worker postMessage failed", {
            id,
            type: request.type,
            error,
            transactionJsonPreview:
              request.type === "proveTransactionJson"
                ? String(request.transactionJson).slice(0, 200)
                : undefined,
          });
          pendingRequestsRef.current.delete(id);
          signal?.removeEventListener("abort", handleAbort);
          reject(toWorkerError(error));
        }
      });
    },
    [],
  );

  const refreshStatus = useCallback(async () => {
    const response = await sendRequest({ type: "getStatus" });
    if (response.ok && response.compileArtifacts) {
      setCompileArtifacts(response.compileArtifacts);
    }
    return response.status;
  }, [sendRequest]);

  const compile = useCallback(
    async (signal?: AbortSignal) => {
      const response = await sendRequest(
        { type: "compile", proofsEnabled },
        signal,
      );
      if (!response.ok || !response.compileArtifacts) {
        throw new Error("Proposal compile did not return compile artifacts.");
      }
      setCompileArtifacts(response.compileArtifacts);
      return response.compileArtifacts;
    },
    [proofsEnabled, sendRequest],
  );

  const proveTransactionJson = useCallback(
    async (transactionJson: string, signal?: AbortSignal) => {
      const response = await sendRequest(
        {
          type: "proveTransactionJson",
          transactionJson,
          proofsEnabled: true,
        },
        signal,
      );
      if (!response.ok || !response.transactionJson) {
        throw new Error(
          "Proposal prover worker did not return a proved transaction.",
        );
      }
      if (response.compileArtifacts) {
        setCompileArtifacts(response.compileArtifacts);
      }
      return response.transactionJson;
    },
    [sendRequest],
  );

  const buildAndProveCreateProposal = useCallback(
    async (
      input: PrepareCreateProposalTransactionInput,
      signal?: AbortSignal,
    ): Promise<{
      preparedTransaction: PreparedCreateProposalTransaction;
      provedTransactionJson: string;
    }> => {
      const response = await sendRequest(
        {
          type: "buildAndProveCreateProposal",
          input,
          proofsEnabled: true,
        },
        signal,
      );
      if (
        !response.ok ||
        !response.preparedCreateProposalTransaction ||
        !response.transactionJson
      ) {
        throw new Error(
          "Proposal prover worker did not return a built and proved proposal transaction.",
        );
      }
      if (response.compileArtifacts) {
        setCompileArtifacts(response.compileArtifacts);
      }
      return {
        preparedTransaction: response.preparedCreateProposalTransaction,
        provedTransactionJson: response.transactionJson,
      };
    },
    [sendRequest],
  );

  const buildAndProveVoteProposal = useCallback(
    async (
      input: PrepareVoteProposalTransactionInput,
      signal?: AbortSignal,
    ): Promise<{
      preparedTransaction: PreparedVoteProposalTransaction;
      provedTransactionJson: string;
    }> => {
      const response = await sendRequest(
        {
          type: "buildAndProveVoteProposal",
          input,
          proofsEnabled: true,
        },
        signal,
      );
      if (
        !response.ok ||
        !response.preparedVoteProposalTransaction ||
        !response.transactionJson
      ) {
        throw new Error(
          "Proposal prover worker did not return a built and proved vote transaction.",
        );
      }
      if (response.compileArtifacts) {
        setCompileArtifacts(response.compileArtifacts);
      }
      return {
        preparedTransaction: response.preparedVoteProposalTransaction,
        provedTransactionJson: response.transactionJson,
      };
    },
    [sendRequest],
  );

  const buildAndProveExecuteProposal = useCallback(
    async (
      input: PrepareExecuteProposalTransactionInput,
      signal?: AbortSignal,
    ): Promise<{
      preparedTransaction: PreparedExecuteProposalTransaction;
      provedTransactionJson: string;
    }> => {
      const response = await sendRequest(
        {
          type: "buildAndProveExecuteProposal",
          input,
          proofsEnabled: true,
        },
        signal,
      );
      if (
        !response.ok ||
        !response.preparedExecuteProposalTransaction ||
        !response.transactionJson
      ) {
        throw new Error(
          "Proposal prover worker did not return a built and proved execute transaction.",
        );
      }
      if (response.compileArtifacts) {
        setCompileArtifacts(response.compileArtifacts);
      }
      return {
        preparedTransaction: response.preparedExecuteProposalTransaction,
        provedTransactionJson: response.transactionJson,
      };
    },
    [sendRequest],
  );

  return {
    status,
    compileArtifacts,
    refreshStatus,
    compile,
    proveTransactionJson,
    buildAndProveCreateProposal,
    buildAndProveVoteProposal,
    buildAndProveExecuteProposal,
  };
}
