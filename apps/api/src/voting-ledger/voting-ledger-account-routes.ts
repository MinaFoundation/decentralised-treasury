import type { EventsApiServerOptions } from "@repo/indexer";
import {
  PUBLIC_KEY_VALIDATION_ERROR,
  normalizePublicKey,
} from "../public-key-validation.js";
import {
  LIFECYCLE_DATA_UNAVAILABLE_ERROR,
  LIFECYCLE_ID_VALIDATION_ERROR,
  normalizeLifecycleId,
} from "../staking-ledger/lifecycle-staking-ledger-service-registry.js";
import {
  LifecycleVotingLedgerFileNotFoundError,
  type VotingLedgerServiceLookup,
} from "../processors/proposals/lifecycle-voting-ledger-service-registry.js";

class RequestValidationError extends Error {}

function parseLifecycleId(value: unknown): string {
  if (typeof value !== "string") {
    throw new RequestValidationError(LIFECYCLE_ID_VALIDATION_ERROR);
  }
  try {
    return normalizeLifecycleId(value);
  } catch {
    throw new RequestValidationError(LIFECYCLE_ID_VALIDATION_ERROR);
  }
}

async function parsePublicKey(value: unknown): Promise<string> {
  try {
    return await normalizePublicKey(value);
  } catch {
    throw new RequestValidationError(PUBLIC_KEY_VALIDATION_ERROR);
  }
}

export interface VotingLedgerAccountRoutesOptions {
  votingLedgerServices: VotingLedgerServiceLookup;
}

export type VotingLedgerAccountPayload = {
  lifecycleId: string;
  publicKey: string;
  account: {
    balance: string;
  };
  voteWeight: string;
};

export function createVotingLedgerAccountRoutes({
  votingLedgerServices,
}: VotingLedgerAccountRoutesOptions): NonNullable<
  EventsApiServerOptions["registerRoutes"]
> {
  return (app) => {
    app.get(
      "/voting-ledger/lifecycles/:lifecycleId/accounts/:publicKey",
      async (request, response) => {
        let lifecycleId: string;
        let publicKey: string;
        try {
          lifecycleId = parseLifecycleId(request.params.lifecycleId);
          publicKey = await parsePublicKey(request.params.publicKey);
        } catch (error) {
          if (error instanceof RequestValidationError) {
            response.status(400).json({
              error: error.message,
            });
            return;
          }
          console.error("[indexer-api] failed to parse voting account route", error);
          response.status(500).json({
            error: "Internal server error",
          });
          return;
        }

        try {
          const service = await votingLedgerServices.getService(lifecycleId);
          const voteWeight = await service.getVoteWeight(publicKey);
          response.json({
            lifecycleId,
            publicKey,
            account: {
              balance: voteWeight.toString(),
            },
            voteWeight: voteWeight.toString(),
          } satisfies VotingLedgerAccountPayload);
        } catch (error) {
          if (error instanceof LifecycleVotingLedgerFileNotFoundError) {
            response.status(404).json({
              error: LIFECYCLE_DATA_UNAVAILABLE_ERROR,
              lifecycleId,
            });
            return;
          }
          console.error("[indexer-api] failed to fetch voting account", error);
          response.status(500).json({
            error: "Internal server error",
          });
        }
      },
    );
  };
}
