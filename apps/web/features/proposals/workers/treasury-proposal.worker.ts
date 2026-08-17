/// <reference lib="webworker" />

import { installRuntimeConfig } from "../../runtime-config/lib/install-runtime-config";
import type { TreasuryRuntimeConfig } from "../../runtime-config/lib/runtime-config.types";
import type { SerializedProposalCompileArtifacts } from "../lib/proposal-prover-runtime";
import type {
  ProposalProverWorkerRequest,
  ProposalProverWorkerResponse,
  ProposalProverWorkerStatus,
} from "../lib/proposal-prover-worker.types";

type ProposalProverRuntime = typeof import("../lib/proposal-prover-runtime");

let compileArtifacts: SerializedProposalCompileArtifacts | null = null;
let compileProofsEnabled: boolean | null = null;
let status: ProposalProverWorkerStatus = {
  ready: false,
  phase: "idle",
  error: null,
};
let proposalProverRuntimePromise: Promise<ProposalProverRuntime> | null = null;

function ensureWorkerWindowAlias(): void {
  const globalScope = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis;
  };
  globalScope.window ??= globalThis as unknown as Window & typeof globalThis;
}

async function getProposalProverRuntime(): Promise<ProposalProverRuntime> {
  ensureWorkerWindowAlias();
  proposalProverRuntimePromise ??= import("../lib/proposal-prover-runtime");
  return proposalProverRuntimePromise;
}

/**
 * Adopts the config the main thread resolved, before anything that reads
 * configuration is imported.
 *
 * The worker's global scope is not the page's, so the inline bootstrap script
 * the server renders never ran here. Without this the prover would fall back to
 * build-time `NEXT_PUBLIC_*` values, which a published image does not carry -
 * surfacing as "Missing required browser prover config" for whichever field the
 * validator happens to check first.
 *
 * Runs on every message: the prover runtime module is imported lazily and only
 * once, so the config must already be in place the first time any handler
 * reaches it, whichever request that turns out to be.
 */
function adoptRuntimeConfig(runtimeConfig: TreasuryRuntimeConfig): void {
  ensureWorkerWindowAlias();
  installRuntimeConfig(runtimeConfig);
}

function getErrorMessage(
  error: unknown,
  fallbackMessage = "Proposal prover worker failed.",
): string {
  if (error instanceof Error) {
    if (error.message.trim()) {
      return error.message;
    }
    if (error.stack?.trim()) {
      return error.stack.split("\n")[0] ?? fallbackMessage;
    }
    return fallbackMessage;
  }
  if (typeof error === "string") {
    return error.trim() || fallbackMessage;
  }
  if (error && typeof error === "object") {
    try {
      const serialized = JSON.stringify(error);
      return serialized && serialized !== "{}" ? serialized : fallbackMessage;
    } catch {
      return fallbackMessage;
    }
  }
  return fallbackMessage;
}

async function ensureCompiled(
  proofsEnabled: boolean,
): Promise<SerializedProposalCompileArtifacts> {
  if (compileArtifacts && compileProofsEnabled === proofsEnabled) {
    console.info("[proposal-prover][worker] reusing compile artifacts", {
      proofsEnabled,
    });
    status = {
      ready: true,
      phase: "idle",
      error: null,
    };
    return compileArtifacts;
  }

  status = {
    ready: false,
    phase: "compiling",
    error: null,
  };
  console.info("[proposal-prover][worker] compiling contracts", {
    proofsEnabled,
  });

  const { serializeProposalCompileArtifactsInCurrentThread } =
    await getProposalProverRuntime();
  compileArtifacts = await serializeProposalCompileArtifactsInCurrentThread({
    proofsEnabled,
  });
  compileProofsEnabled = proofsEnabled;
  console.info("[proposal-prover][worker] compile complete", {
    proofsEnabled,
    compileArtifactKeys: Object.keys(compileArtifacts ?? {}),
  });
  status = {
    ready: true,
    phase: "idle",
    error: null,
  };
  return compileArtifacts;
}

function postResponse(response: ProposalProverWorkerResponse): void {
  const safeResponse = JSON.parse(
    JSON.stringify(response),
  ) as ProposalProverWorkerResponse;
  console.info("[proposal-prover][worker] posting response", {
    id: safeResponse.id,
    ok: safeResponse.ok,
    phase: safeResponse.status.phase,
    ready: safeResponse.status.ready,
    hasCompileArtifacts: safeResponse.ok
      ? Boolean(safeResponse.compileArtifacts)
      : false,
    transactionJsonType: safeResponse.ok
      ? typeof safeResponse.transactionJson
      : undefined,
    transactionJsonLength:
      safeResponse.ok && typeof safeResponse.transactionJson === "string"
        ? safeResponse.transactionJson.length
        : undefined,
  });
  self.postMessage(safeResponse);
}

self.onmessage = async (event: MessageEvent<ProposalProverWorkerRequest>) => {
  const message = event.data;
  adoptRuntimeConfig(message.runtimeConfig);
  console.info("[proposal-prover][worker] received request", {
    id: message.id,
    type: message.type,
    proofsEnabled:
      "proofsEnabled" in message ? message.proofsEnabled : undefined,
    transactionJsonType:
      message.type === "proveTransactionJson"
        ? typeof message.transactionJson
        : undefined,
    transactionJsonLength:
      message.type === "proveTransactionJson" &&
      typeof message.transactionJson === "string"
        ? message.transactionJson.length
        : undefined,
  });

  try {
    if (message.type === "getStatus") {
      postResponse({
        id: message.id,
        ok: true,
        status,
        compileArtifacts: compileArtifacts ?? undefined,
      });
      return;
    }

    if (message.type === "compile") {
      const nextArtifacts = await ensureCompiled(message.proofsEnabled);
      postResponse({
        id: message.id,
        ok: true,
        status,
        compileArtifacts: nextArtifacts,
      });
      return;
    }

    if (message.type === "buildAndProveCreateProposal") {
      const createStartedAt = Date.now();
      const nextCompileArtifacts = await ensureCompiled(message.proofsEnabled);
      console.info("[proposal-prover][worker] create compile artifacts ready", {
        id: message.id,
        elapsedMs: Date.now() - createStartedAt,
      });
      status = {
        ready: true,
        phase: "proving",
        error: null,
      };
      console.info(
        "[proposal-prover][worker] building and proving create proposal",
        {
          id: message.id,
          senderAddress: message.input.senderAddress,
          lifecycleId: message.input.lifecycleId,
        },
      );
      const { buildAndProveCreateProposalTransactionInCurrentThread } =
        await getProposalProverRuntime();
      const {
        preparedTransaction: preparedCreateProposalTransaction,
        provedTransactionJson: transactionJson,
      } = await buildAndProveCreateProposalTransactionInCurrentThread(
        message.input,
        {
          proofsEnabled: message.proofsEnabled,
          compileArtifacts: nextCompileArtifacts,
        },
      );
      console.info(
        "[proposal-prover][worker] create build and prove complete",
        {
          id: message.id,
          proposalPublicKey:
            preparedCreateProposalTransaction.proposalPublicKey,
          elapsedMs: Date.now() - createStartedAt,
          transactionJsonLength: transactionJson.length,
        },
      );
      status = {
        ready: true,
        phase: "idle",
        error: null,
      };
      postResponse({
        id: message.id,
        ok: true,
        status,
        compileArtifacts: compileArtifacts ?? undefined,
        preparedCreateProposalTransaction,
        transactionJson,
      });
      return;
    }

    if (message.type === "buildAndProveVoteProposal") {
      const nextCompileArtifacts = await ensureCompiled(message.proofsEnabled);
      status = {
        ready: true,
        phase: "proving",
        error: null,
      };
      console.info(
        "[proposal-prover][worker] building and proving vote proposal",
        {
          id: message.id,
          senderAddress: message.input.senderAddress,
          proposalPublicKey: message.input.proposalPublicKey,
          vote: message.input.vote,
        },
      );
      const { buildAndProveVoteProposalTransactionInCurrentThread } =
        await getProposalProverRuntime();
      const {
        preparedTransaction: preparedVoteProposalTransaction,
        provedTransactionJson: transactionJson,
      } = await buildAndProveVoteProposalTransactionInCurrentThread(
        message.input,
        {
          proofsEnabled: message.proofsEnabled,
          compileArtifacts: nextCompileArtifacts,
        },
      );
      status = {
        ready: true,
        phase: "idle",
        error: null,
      };
      postResponse({
        id: message.id,
        ok: true,
        status,
        compileArtifacts: compileArtifacts ?? undefined,
        preparedVoteProposalTransaction,
        transactionJson,
      });
      return;
    }

    if (message.type === "buildAndProveExecuteProposal") {
      const nextCompileArtifacts = await ensureCompiled(message.proofsEnabled);
      status = {
        ready: true,
        phase: "proving",
        error: null,
      };
      console.info(
        "[proposal-prover][worker] building and proving execute proposal",
        {
          id: message.id,
          senderAddress: message.input.senderAddress,
          proposalPublicKey: message.input.proposalPublicKey,
          recipient: message.input.recipient,
        },
      );
      const { buildAndProveExecuteProposalTransactionInCurrentThread } =
        await getProposalProverRuntime();
      const {
        preparedTransaction: preparedExecuteProposalTransaction,
        provedTransactionJson: transactionJson,
      } = await buildAndProveExecuteProposalTransactionInCurrentThread(
        message.input,
        {
          proofsEnabled: message.proofsEnabled,
          compileArtifacts: nextCompileArtifacts,
        },
      );
      status = {
        ready: true,
        phase: "idle",
        error: null,
      };
      postResponse({
        id: message.id,
        ok: true,
        status,
        compileArtifacts: compileArtifacts ?? undefined,
        preparedExecuteProposalTransaction,
        transactionJson,
      });
      return;
    }

    await ensureCompiled(message.proofsEnabled);
    status = {
      ready: true,
      phase: "proving",
      error: null,
    };
    console.info("[proposal-prover][worker] proving transaction json", {
      id: message.id,
      transactionJsonType: typeof message.transactionJson,
      transactionJsonLength:
        typeof message.transactionJson === "string"
          ? message.transactionJson.length
          : undefined,
    });
    const { proveTransactionJsonInCurrentThread } =
      await getProposalProverRuntime();
    const transactionJson = await proveTransactionJsonInCurrentThread(
      message.transactionJson,
      {
        proofsEnabled: message.proofsEnabled,
      },
    );
    console.info("[proposal-prover][worker] prove complete", {
      id: message.id,
      transactionJsonType: typeof transactionJson,
      transactionJsonLength:
        typeof transactionJson === "string"
          ? transactionJson.length
          : undefined,
    });
    status = {
      ready: true,
      phase: "idle",
      error: null,
    };
    postResponse({
      id: message.id,
      ok: true,
      status,
      compileArtifacts: compileArtifacts ?? undefined,
      transactionJson,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("[proposal-prover][worker] request failed", {
      id: message.id,
      type: message.type,
      error,
      errorMessage,
    });
    status = {
      ready: Boolean(compileArtifacts),
      phase: "idle",
      error: errorMessage,
    };
    postResponse({
      id: message.id,
      ok: false,
      error: errorMessage,
      status,
    });
  }
};

export {};
