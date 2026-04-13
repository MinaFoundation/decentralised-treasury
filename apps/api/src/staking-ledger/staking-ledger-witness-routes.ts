import type { EventsApiServerOptions } from "@repo/indexer";
import { Account } from "@repo/sdk/src/provable/account.js";
import type { PrefixedMerkleWitness36 } from "@repo/sdk/src/provable/merkle-tree/prefixed-merkle-tree.js";
import {
  PUBLIC_KEY_VALIDATION_ERROR,
  normalizePublicKey,
} from "../public-key-validation.js";
import {
  LIFECYCLE_DATA_UNAVAILABLE_ERROR,
  LIFECYCLE_ID_VALIDATION_ERROR,
  LifecycleStakingLedgerFileNotFoundError,
  LifecycleStakingLedgerServiceRegistry,
  normalizeLifecycleId,
} from "./lifecycle-staking-ledger-service-registry.js";

class RequestValidationError extends Error {}
export const STAKING_LEDGER_ACCOUNT_NOT_FOUND_ERROR =
  "staking account for publicKey is not available";

const accountCodec = Account as unknown as {
  toJSON(value: unknown): Record<string, unknown>;
};

function toAccountJson(account: unknown): Record<string, unknown> {
  return accountCodec.toJSON(account);
}

function toWitnessJson(witness: PrefixedMerkleWitness36): Record<string, unknown> {
  return (witness as unknown as { toJSON(): Record<string, unknown> }).toJSON();
}

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

function parseIndex(value: unknown): bigint {
  if (typeof value !== "string") {
    throw new RequestValidationError("index must be a non-negative integer");
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new RequestValidationError("index must be a non-negative integer");
  }

  return BigInt(normalized);
}

async function parsePublicKey(value: unknown): Promise<string> {
  try {
    return await normalizePublicKey(value);
  } catch {
    throw new RequestValidationError(PUBLIC_KEY_VALIDATION_ERROR);
  }
}

function isOutOfRangeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.includes("is out of range");
}

export interface StakingLedgerWitnessRoutesOptions {
  stakingLedgerServices: LifecycleStakingLedgerServiceRegistry;
}

export function createStakingLedgerWitnessRoutes({
  stakingLedgerServices,
}: StakingLedgerWitnessRoutesOptions): NonNullable<
  EventsApiServerOptions["registerRoutes"]
> {
  return (app) => {
    app.get(
      "/staking-ledger/lifecycles/:lifecycleId/witnesses/:index",
      async (request, response) => {
        let lifecycleId: string;
        let index: bigint;
        try {
          lifecycleId = parseLifecycleId(request.params.lifecycleId);
          index = parseIndex(request.params.index);
        } catch (error) {
          if (error instanceof RequestValidationError) {
            response.status(400).json({
              error: error.message,
            });
            return;
          }

          console.error("[indexer-api] failed to parse staking witness route", error);
          response.status(500).json({
            error: "Internal server error",
          });
          return;
        }

        try {
          const service = await stakingLedgerServices.getService(lifecycleId);
          const [account, witness] = await Promise.all([
            service.getAccount(index),
            service.getWitness(index),
          ]);

          response.json({
            lifecycleId,
            index: index.toString(),
            account: toAccountJson(account),
            witness: toWitnessJson(witness),
          });
        } catch (error) {
          if (error instanceof LifecycleStakingLedgerFileNotFoundError) {
            response.status(404).json({
              error: LIFECYCLE_DATA_UNAVAILABLE_ERROR,
              lifecycleId,
            });
            return;
          }
          if (isOutOfRangeError(error)) {
            response.status(400).json({
              error: error instanceof Error ? error.message : "Invalid leaf index",
            });
            return;
          }
          console.error("[indexer-api] failed to fetch staking witness", error);
          response.status(500).json({
            error: "Internal server error",
          });
        }
      },
    );

    app.get(
      "/staking-ledger/lifecycles/:lifecycleId/accounts/:publicKey",
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

          console.error("[indexer-api] failed to parse staking account route", error);
          response.status(500).json({
            error: "Internal server error",
          });
          return;
        }

        try {
          const service = await stakingLedgerServices.getService(lifecycleId);
          const accountLookup = await service.getAccountByPublicKey(publicKey);
          if (!accountLookup) {
            response.status(404).json({
              error: STAKING_LEDGER_ACCOUNT_NOT_FOUND_ERROR,
              lifecycleId,
              publicKey,
            });
            return;
          }
          const accountJson = toAccountJson(accountLookup.account);

          response.json({
            lifecycleId,
            publicKey,
            index: accountLookup.index.toString(),
            account: accountJson,
            balance: accountJson.balance,
            delegatePublicKey: accountJson.delegate,
          });
        } catch (error) {
          if (error instanceof LifecycleStakingLedgerFileNotFoundError) {
            response.status(404).json({
              error: LIFECYCLE_DATA_UNAVAILABLE_ERROR,
              lifecycleId,
            });
            return;
          }
          console.error("[indexer-api] failed to fetch staking account", error);
          response.status(500).json({
            error: "Internal server error",
          });
        }
      },
    );
  };
}

export type StakingLedgerWitnessPayload = {
  lifecycleId: string;
  index: string;
  account: Record<string, unknown>;
  witness: Record<string, unknown>;
};
