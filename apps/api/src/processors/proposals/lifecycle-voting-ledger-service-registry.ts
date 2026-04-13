import { existsSync } from "node:fs";
import { getSqliteDbPath } from "@repo/sdk/src/storage/sqlite/sqlite-db-path.js";

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

export class LifecycleVotingLedgerFileNotFoundError extends Error {
  public constructor(public readonly lifecycleId: string) {
    super("data for lifecycleid is not available");
    this.name = "LifecycleVotingLedgerFileNotFoundError";
  }
}

class SqliteVotingLedgerService implements VotingLedgerService {
  private voteReducerService: {
    start(): Promise<void>;
    getVoteWeight(voterPublicKey: string): Promise<bigint>;
    close(): Promise<void>;
  } | null = null;

  public constructor(private readonly lifecycleId: string) {}

  public async start(): Promise<void> {
    if (!this.voteReducerService) {
      const moduleName = "@repo/sdk/src/services/sqlite/sqlite-vote-reducer-service.js";
      const voteReducerModule = (await import(moduleName)) as {
        SqliteVoteReducerService: new (options: {
          lifecycleId: string;
        }) => {
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

export class LifecycleVotingLedgerServiceRegistry
  implements VotingLedgerServiceLookup
{
  private readonly services = new Map<string, VotingLedgerService>();
  private readonly servicePromises = new Map<string, Promise<VotingLedgerService>>();

  public constructor(
    private readonly createService: CreateVotingLedgerService = (lifecycleId) => {
      const sqlitePath = getSqliteDbPath(lifecycleId);
      if (!existsSync(sqlitePath)) {
        throw new LifecycleVotingLedgerFileNotFoundError(lifecycleId);
      }
      return new SqliteVotingLedgerService(lifecycleId);
    },
  ) {}

  public async getService(lifecycleId: string): Promise<VotingLedgerService> {
    const existingService = this.services.get(lifecycleId);
    if (existingService) {
      return existingService;
    }

    const inFlight = this.servicePromises.get(lifecycleId);
    if (inFlight) {
      return await inFlight;
    }

    const startupPromise = (async () => {
      const service = this.createService(lifecycleId);
      await service.start();
      this.services.set(lifecycleId, service);
      this.servicePromises.delete(lifecycleId);
      return service;
    })().catch((error) => {
      this.servicePromises.delete(lifecycleId);
      throw error;
    });

    this.servicePromises.set(lifecycleId, startupPromise);
    return await startupPromise;
  }

  public async close(): Promise<void> {
    const activeServices = Array.from(this.services.values());
    this.services.clear();
    this.servicePromises.clear();
    await Promise.all(activeServices.map((service) => service.close()));
  }
}
