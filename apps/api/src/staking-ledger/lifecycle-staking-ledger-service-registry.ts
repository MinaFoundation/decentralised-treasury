import {
  completedSnapshotIdentity,
  LifecycleStakingLedgerFileNotFoundError,
} from "./completed-snapshot.js";
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

export { LifecycleStakingLedgerFileNotFoundError };

export class LifecycleStakingLedgerServiceRegistry implements StakingLedgerServiceLookup {
  private readonly services = new Map<string, StakingLedgerService>();
  private readonly startupPromises = new Map<
    string,
    Promise<StakingLedgerService>
  >();
  private state: RegistryState = "open";
  private closePromise: Promise<void> | null = null;

  private readonly identities = new Map<string, string>();
  private readonly createService: (lifecycleId: string) => StakingLedgerService;
  private readonly snapshotIdentity: (lifecycleId: string) => string;

  public constructor(
    createService?: (lifecycleId: string) => StakingLedgerService,
    snapshotIdentity?: (lifecycleId: string) => string,
  ) {
    this.createService =
      createService ??
      ((lifecycleId) =>
        new SqliteStakingLedgerService({
          lifecycleId,
          dbPath: getSqliteDbPath(lifecycleId),
        }));
    this.snapshotIdentity =
      snapshotIdentity ??
      (createService ? () => "custom" : completedSnapshotIdentity);
  }

  public async getService(lifecycleId: string): Promise<StakingLedgerService> {
    if (this.state !== "open") {
      throw new Error(REGISTRY_CLOSED_ERROR);
    }
    const normalizedLifecycleId = normalizeLifecycleId(lifecycleId);

    const inFlight = this.startupPromises.get(normalizedLifecycleId);
    if (inFlight) return await inFlight;

    let startupPromise: Promise<StakingLedgerService>;
    startupPromise = (async () => {
      await Promise.resolve();
      let service: StakingLedgerService | null = null;
      let serviceClosed = false;
      try {
        const identity = this.snapshotIdentity(normalizedLifecycleId);
        const existing = this.services.get(normalizedLifecycleId);
        if (existing && this.identities.get(normalizedLifecycleId) === identity)
          return existing;
        if (existing) {
          this.services.delete(normalizedLifecycleId);
          this.identities.delete(normalizedLifecycleId);
          await existing.close();
        }
        service = this.createService(normalizedLifecycleId);
        await service.start();
        if (this.state !== "open") {
          await service.close();
          serviceClosed = true;
          throw new Error(REGISTRY_CLOSED_ERROR);
        }
        if (this.snapshotIdentity(normalizedLifecycleId) !== identity) {
          throw new LifecycleStakingLedgerFileNotFoundError(
            normalizedLifecycleId,
          );
        }
        this.identities.set(normalizedLifecycleId, identity);
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
        this.identities.clear();
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
