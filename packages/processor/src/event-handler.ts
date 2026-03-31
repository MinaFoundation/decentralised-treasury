import type { ArchiveEventEntity } from "@repo/indexer";
import type { EntityManager } from "typeorm";

export interface EventProcessorHandler {
  readonly eventType: string;
  tryHandle(event: ArchiveEventEntity, manager: EntityManager): Promise<boolean>;
}
