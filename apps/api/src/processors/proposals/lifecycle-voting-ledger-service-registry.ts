import {
  completedSnapshotIdentity,
  LifecycleStakingLedgerFileNotFoundError,
} from "../../staking-ledger/completed-snapshot.js";
import { MAX_UINT32 } from "./proposal-contract-domain.js";

// TODO: Add CLI/SDK support to compute and materialize lifecycle voting ledgers
// out-of-circuit, so <lifecycleId>.sqlite can be generated faster.

export interface VotingLedgerService {
  start(): Promise<void>;
  getVoteWeight(voterPublicKey: string): Promise<bigint>;
  close(): Promise<void>;
}

export interface VotingLedgerServiceLookup {
  getService(lifecycleId: string): Promise<VotingLedgerService>;
}

type CreateVotingLedgerService = (lifecycleId: string) => VotingLedgerService;

type RegistryState = "open" | "closing" | "closed";

const REGISTRY_CLOSED_ERROR =
  "LifecycleVotingLedgerServiceRegistry is closing or closed";

function normalizeLifecycleId(lifecycleId: string): string {
  const normalized = lifecycleId.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("lifecycleId must be an unsigned 32-bit integer string");
  }
  const parsed = BigInt(normalized);
  if (parsed > MAX_UINT32) {
    throw new Error("lifecycleId must be an unsigned 32-bit integer string");
  }
  return parsed.toString();
}

export { LifecycleStakingLedgerFileNotFoundError as LifecycleVotingLedgerFileNotFoundError };

class SqliteVotingLedgerService implements VotingLedgerService {
  private voteReducerService: {
    start(): Promise<void>;
    getVoteWeight(voterPublicKey: string): Promise<bigint>;
    close(): Promise<void>;
  } | null = null;

  public constructor(private readonly lifecycleId: string) {}

  public async start(): Promise<void> {
    if (!this.voteReducerService) {
      const moduleName =
        "@repo/sdk/src/services/sqlite/sqlite-vote-reducer-service.js";
      const voteReducerModule = (await import(moduleName)) as {
        SqliteVoteReducerService: new (options: { lifecycleId: string }) => {
          start(): Promise<void>;
          getVoteWeight(voterPublicKey: string): Promise<bigint>;
          close(): Promise<void>;
        };
      };
      this.voteReducerService = new voteReducerModule.SqliteVoteReducerService({
        lifecycleId: this.lifecycleId,
      });
    }
    await this.voteReducerService.start();
  }

  public async getVoteWeight(voterPublicKey: string): Promise<bigint> {
    if (!this.voteReducerService) {
      throw new Error(
        "SqliteVotingLedgerService.start() must be called before getVoteWeight()",
      );
    }
    return await this.voteReducerService.getVoteWeight(voterPublicKey);
  }

  public async close(): Promise<void> {
    if (this.voteReducerService) {
      await this.voteReducerService.close();
      this.voteReducerService = null;
    }
  }
}

export class LifecycleVotingLedgerServiceRegistry implements VotingLedgerServiceLookup {
  private readonly services = new Map<string, VotingLedgerService>();
  private readonly servicePromises = new Map<
    string,
    Promise<VotingLedgerService>
  >();
  private state: RegistryState = "open";
  private closePromise: Promise<void> | null = null;

  private readonly identities = new Map<string, string>();
  private readonly createService: (lifecycleId: string) => VotingLedgerService;
  private readonly snapshotIdentity: (lifecycleId: string) => string;

  public constructor(
    createService?: (lifecycleId: string) => VotingLedgerService,
    snapshotIdentity?: (lifecycleId: string) => string,
  ) {
    this.createService =
      createService ??
      ((lifecycleId) => new SqliteVotingLedgerService(lifecycleId));
    this.snapshotIdentity =
      snapshotIdentity ??
      (createService ? () => "custom" : completedSnapshotIdentity);
  }

  public async getService(lifecycleId: string): Promise<VotingLedgerService> {
    if (this.state !== "open") {
      throw new Error(REGISTRY_CLOSED_ERROR);
    }
    const normalizedLifecycleId = normalizeLifecycleId(lifecycleId);
    const inFlight = this.servicePromises.get(normalizedLifecycleId);
    if (inFlight) return await inFlight;

    let startupPromise: Promise<VotingLedgerService>;
    startupPromise = (async () => {
      await Promise.resolve();
      let service: VotingLedgerService | null = null;
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
              `Failed to start and clean up voting ledger service for lifecycleId=${normalizedLifecycleId}`,
            );
          }
        }
        throw error;
      } finally {
        if (
          this.servicePromises.get(normalizedLifecycleId) === startupPromise
        ) {
          this.servicePromises.delete(normalizedLifecycleId);
        }
      }
    })();

    this.servicePromises.set(normalizedLifecycleId, startupPromise);
    return await startupPromise;
  }

  public async close(): Promise<void> {
    if (this.closePromise) {
      return await this.closePromise;
    }
    this.state = "closing";
    this.closePromise = (async () => {
      try {
        await Promise.allSettled(Array.from(this.servicePromises.values()));
        const activeServices = Array.from(this.services.values());
        this.services.clear();
        this.identities.clear();
        const results = await Promise.allSettled(
          activeServices.map((service) => service.close()),
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
            "Failed to close one or more voting ledger services",
          );
        }
      } finally {
        this.servicePromises.clear();
        this.state = "closed";
      }
    })();
    return await this.closePromise;
  }
}
