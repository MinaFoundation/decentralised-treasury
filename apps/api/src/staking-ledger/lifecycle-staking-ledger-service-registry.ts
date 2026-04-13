import { existsSync } from "node:fs";
import { SqliteStakingLedgerService } from "@repo/sdk/src/services/sqlite/sqlite-staking-ledger-service.js";
import { getSqliteDbPath } from "@repo/sdk/src/storage/sqlite/sqlite-db-path.js";
import type { StakingLedgerService } from "@repo/sdk/src/services/staking-ledger-service.js";

const MAX_UINT64 = 18_446_744_073_709_551_615n;

export type CreateStakingLedgerService = (
  lifecycleId: string,
) => StakingLedgerService;

export interface StakingLedgerServiceLookup {
  getService(lifecycleId: string): Promise<StakingLedgerService>;
}

export const LIFECYCLE_DATA_UNAVAILABLE_ERROR =
  "data for lifecycleid is not available";
export const LIFECYCLE_ID_VALIDATION_ERROR =
  "lifecycleId must be an unsigned 64-bit integer string";

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
  if (parsedLifecycleId > MAX_UINT64) {
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

export class LifecycleStakingLedgerServiceRegistry
  implements StakingLedgerServiceLookup
{
  private readonly services = new Map<string, StakingLedgerService>();
  private readonly startupPromises = new Map<string, Promise<StakingLedgerService>>();

  public constructor(
    private readonly createService: CreateStakingLedgerService = (lifecycleId) =>
      {
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
    const normalizedLifecycleId = normalizeLifecycleId(lifecycleId);

    const existingService = this.services.get(normalizedLifecycleId);
    if (existingService) {
      return existingService;
    }

    const existingStartupPromise = this.startupPromises.get(normalizedLifecycleId);
    if (existingStartupPromise) {
      return await existingStartupPromise;
    }

    const startupPromise = (async () => {
      const service = this.createService(normalizedLifecycleId);
      await service.start();
      this.services.set(normalizedLifecycleId, service);
      this.startupPromises.delete(normalizedLifecycleId);
      return service;
    })().catch((error) => {
      this.startupPromises.delete(normalizedLifecycleId);
      throw error;
    });

    this.startupPromises.set(normalizedLifecycleId, startupPromise);
    return await startupPromise;
  }

  public async close(): Promise<void> {
    this.startupPromises.clear();
    const servicesToClose = Array.from(this.services.values());
    this.services.clear();
    await Promise.all(
      servicesToClose.map(async (service) => {
        await service.close();
      }),
    );
  }
}
