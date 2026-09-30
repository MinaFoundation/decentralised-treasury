import type { ArchiveEventEntity } from "@repo/indexer";
import type { EntityManager } from "typeorm";

export interface EventProcessorHandler {
  readonly eventType: string;
  // Return false only when the event cannot be decoded. Throw on operational
  // failures so the processor retries without advancing its offset.
  tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean>;
}

/** A dependency can recover without changing the event. */
export class TransientEventError extends Error {
  public readonly code = "EVENT_DEPENDENCY_UNAVAILABLE";
}
