import type { ArchiveEventEntity } from "@repo/indexer";
import type { EntityManager } from "typeorm";
import type { EventProcessorHandler } from "../../src/event-handler.js";
import { TestProjectionEntity } from "./test-projection-entity.js";

interface DecodedProjectionPayload {
  eventKey: string;
  payload: string;
}

function decodeProjectionPayload(
  event: ArchiveEventEntity,
): DecodedProjectionPayload | null {
  const data = event.rawEventData.data;
  if (!Array.isArray(data) || data.length !== 2) {
    return null;
  }

  const eventKey = data[0];
  const payload = data[1];
  if (typeof eventKey !== "string" || typeof payload !== "string") {
    return null;
  }

  return {
    eventKey,
    payload,
  };
}

export class TestProjectionEventHandler implements EventProcessorHandler {
  public readonly eventType = "testProjectionCreated";

  public async tryHandle(
    event: ArchiveEventEntity,
    manager: EntityManager,
  ): Promise<boolean> {
    const repository = manager.getRepository(TestProjectionEntity);
    const payload = decodeProjectionPayload(event);
    if (!payload) {
      return false;
    }

    if (event.status === "orphaned") {
      await repository.delete({
        eventKey: payload.eventKey,
      });
      return true;
    }

    await repository.upsert(
      {
        eventKey: payload.eventKey,
        payload: payload.payload,
        status: event.status,
      },
      ["eventKey"],
    );
    return true;
  }
}
