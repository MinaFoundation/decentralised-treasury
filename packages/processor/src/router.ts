import type { ArchiveEventEntity } from "@repo/indexer";
import type { EntityManager } from "typeorm";
import type { EventProcessorHandler } from "./event-handler.js";

interface DispatchResult {
  handled: boolean;
  resolvedEventType: string | null;
}

export class EventProcessorRouter {
  private readonly handlersByType = new Map<string, EventProcessorHandler>();

  public constructor(handlers: EventProcessorHandler[]) {
    for (const handler of handlers) {
      if (this.handlersByType.has(handler.eventType)) {
        throw new Error(
          `duplicate processor handler for event type "${handler.eventType}"`,
        );
      }
      this.handlersByType.set(handler.eventType, handler);
    }
  }

  public getHandledEventTypes(): string[] {
    return Array.from(this.handlersByType.keys());
  }

  public async dispatch(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<DispatchResult> {
    if (event.eventType && event.eventType !== "unknown") {
      const typedHandler = this.handlersByType.get(event.eventType);
      if (typedHandler) {
        const handled = await typedHandler.tryHandle(event, manager);
        if (handled) {
          return { handled: true, resolvedEventType: typedHandler.eventType };
        }
      }
    }

    for (const handler of this.handlersByType.values()) {
      if (handler.eventType === event.eventType) {
        continue;
      }
      const handled = await handler.tryHandle(event, manager);
      if (handled) {
        return { handled: true, resolvedEventType: handler.eventType };
      }
    }

    return { handled: false, resolvedEventType: null };
  }
}
