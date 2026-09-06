import { existsSync } from "node:fs";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { getSqliteDbPath } from "@repo/sdk/src/storage/sqlite/sqlite-db-path.js";
import type { StakingLedgerService } from "@repo/sdk/src/services/staking-ledger-service.js";
import { MAX_UINT32 } from "../processors/proposals/proposal-contract-domain.js";

type RegistryState = "open" | "closing" | "closed";

const REGISTRY_CLOSED_ERROR =
  "LifecycleStakingLedgerServiceRegistry is closing or closed";

export type CreateStakingLedgerService = (
  lifecycleId: string,
) => StakingLedgerService;

export interface StakingLedgerServiceLookup {
  getService(lifecycleId: string): Promise<StakingLedgerService>;
}

export const LIFECYCLE_DATA_UNAVAILABLE_ERROR =
  "data for lifecycleid is not available";
export const LIFECYCLE_ID_VALIDATION_ERROR =
  "lifecycleId must be an unsigned 32-bit integer string";

export function normalizeLifecycleId(lifecycleId: string): string {
  const normalizedLifecycleId = lifecycleId.trim();
  if (!normalizedLifecycleId || !/^\d+$/.test(normalizedLifecycleId)) {
    throw new Error(LIFECYCLE_ID_VALIDATION_ERROR);
  }
  if (normalizedLifecycleId.length > 20) {
    throw new Error(LIFECYCLE_ID_VALIDATION_ERROR);
  }
  let parsedLifecycleId: bigint;
  try {
    parsedLifecycleId = BigInt(normalizedLifecycleId);
  } catch {
    throw new Error(LIFECYCLE_ID_VALIDATION_ERROR);
  }
  if (parsedLifecycleId > MAX_UINT32) {
    throw new Error(LIFECYCLE_ID_VALIDATION_ERROR);
  }
  return parsedLifecycleId.toString();
}

export class LifecycleStakingLedgerFileNotFoundError extends Error {
  public constructor(public readonly lifecycleId: string) {
    super(LIFECYCLE_DATA_UNAVAILABLE_ERROR);
    this.name = "LifecycleStakingLedgerFileNotFoundError";
  }
}

export class LifecycleStakingLedgerServiceRegistry implements StakingLedgerServiceLookup {
  private readonly services = new Map<string, StakingLedgerService>();
  private readonly startupPromises = new Map<
    string,
    Promise<StakingLedgerService>
  >();
  private state: RegistryState = "open";
  private closePromise: Promise<void> | null = null;

  public constructor(
    private readonly createService: CreateStakingLedgerService = (
      lifecycleId,
    ) => {
      const sqlitePath = getSqliteDbPath(lifecycleId);
      console.log("sqlitePath", sqlitePath);
      if (!existsSync(sqlitePath)) {
        throw new LifecycleStakingLedgerFileNotFoundError(lifecycleId);
      }
      return new SqliteStakingLedgerService({
        lifecycleId,
        dbPath: sqlitePath,
      });
    },
  ) {}

  public async getService(lifecycleId: string): Promise<StakingLedgerService> {
    if (this.state !== "open") {
      throw new Error(REGISTRY_CLOSED_ERROR);
    }
    const normalizedLifecycleId = normalizeLifecycleId(lifecycleId);

    const existingService = this.services.get(normalizedLifecycleId);
    if (existingService) {
      return existingService;
    }

    const existingStartupPromise = this.startupPromises.get(
      normalizedLifecycleId,
    );
    if (existingStartupPromise) {
      return await existingStartupPromise;
    }

    let startupPromise: Promise<StakingLedgerService>;
    startupPromise = (async () => {
      let service: StakingLedgerService | null = null;
      let serviceClosed = false;
      try {
        service = this.createService(normalizedLifecycleId);
        await service.start();
        if (this.state !== "open") {
          await service.close();
          serviceClosed = true;
          throw new Error(REGISTRY_CLOSED_ERROR);
        }
        this.services.set(normalizedLifecycleId, service);
        return service;
      } catch (error) {
        if (service && !serviceClosed) {
          try {
            await service.close();
          } catch (closeError) {
            throw new AggregateError(
              [error, closeError],
              `Failed to start and clean up staking ledger service for lifecycleId=${normalizedLifecycleId}`,
            );
          }
        }
        throw error;
      } finally {
        if (
          this.startupPromises.get(normalizedLifecycleId) === startupPromise
        ) {
          this.startupPromises.delete(normalizedLifecycleId);
        }
      }
    })();

    this.startupPromises.set(normalizedLifecycleId, startupPromise);
    return await startupPromise;
  }

  public async close(): Promise<void> {
    if (this.closePromise) {
      return await this.closePromise;
    }
    this.state = "closing";
    this.closePromise = (async () => {
      try {
        await Promise.allSettled(Array.from(this.startupPromises.values()));
        const servicesToClose = Array.from(this.services.values());
        this.services.clear();
        const results = await Promise.allSettled(
          servicesToClose.map((service) => service.close()),
        );
        const closeErrors = results
          .filter(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          )
          .map((result) => result.reason);
        if (closeErrors.length > 0) {
          throw new AggregateError(
            closeErrors,
            "Failed to close one or more staking ledger services",
          );
        }
      } finally {
        this.startupPromises.clear();
        this.state = "closed";
      }
    })();
    return await this.closePromise;
  }
}
