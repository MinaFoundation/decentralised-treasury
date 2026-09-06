/// <reference lib="webworker" />

import type { ProverRequest, ProverResponse, ProverStatus } from "../prover-worker.types";

let status: ProverStatus = { ready: false, phase: "idle", error: null };
let queue = Promise.resolve();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function respond(response: ProverResponse): void {
  self.postMessage(JSON.parse(JSON.stringify(response)) as ProverResponse);
}

async function handle(request: ProverRequest): Promise<void> {
  try {
    if (request.type === "status") {
      respond({ id: request.id, ok: true, status });
      return;
    }
    const runtime = await import("../prover-runtime");
    if (request.type === "compile") {
      status = { ready: false, phase: "compiling", error: null };
      await runtime.compileBreakGlassContracts(
        request.config,
        request.includeProposalContracts,
      );
      status = { ready: true, phase: "idle", error: null };
      respond({ id: request.id, ok: true, status });
      return;
    }
    status = { ready: true, phase: "proving", error: null };
    const transactionJson = await runtime.buildAndProveBreakGlassTransaction({
      config: request.config,
      operation: request.operation,
      senderAddress: request.senderAddress,
      fee: request.fee,
      memo: request.memo,
    });
    status = { ready: true, phase: "idle", error: null };
    respond({ id: request.id, ok: true, status, transactionJson });
  } catch (error) {
    const message = errorMessage(error);
    status = { ...status, phase: "idle", error: message };
    respond({ id: request.id, ok: false, status, error: message });
  }
}

self.onmessage = (event: MessageEvent<ProverRequest>) => {
  queue = queue.then(() => handle(event.data));
};
