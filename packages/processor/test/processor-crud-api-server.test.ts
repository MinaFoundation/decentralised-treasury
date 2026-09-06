import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, describe, it } from "node:test";
import type { DataSource } from "typeorm";
import { ProcessorCrudApiServer } from "../src/index.js";
import { createInMemoryDataSource } from "./support/create-in-memory-data-source.js";
import { TestProjectionEntity } from "./support/test-projection-entity.js";

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() =>
          reject(new Error("Unable to resolve ephemeral port")),
        );
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

describe("ProcessorCrudApiServer", () => {
  let dataSource: DataSource | null = null;
  let server: ProcessorCrudApiServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    dataSource = null;
  });

  it("serves health, collection, and detail reads and stops cleanly", async () => {
    dataSource = createInMemoryDataSource("public", [TestProjectionEntity]);
    await dataSource.initialize();
    await dataSource.synchronize();
    const repository = dataSource.getRepository(TestProjectionEntity);
    const first = await repository.save({
      eventKey: "first",
      payload: "payload-first",
      status: "pending",
    });
    await repository.save({
      eventKey: "second",
      payload: "payload-second",
      status: "canonical",
    });
    const port = await getAvailablePort();
    server = new ProcessorCrudApiServer({
      dataSource,
      port,
      routePrefix: "/processor/",
      pageLimitDefault: 10,
      pageLimitMax: 20,
      outputEntitySchemas: [TestProjectionEntity],
      readOnly: true,
    });

    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    await server.start();
    await server.start();
    assert.equal(process.listenerCount("SIGINT"), sigintListeners + 1);
    assert.equal(process.listenerCount("SIGTERM"), sigtermListeners + 1);

    const healthResponse = await fetch(
      `http://127.0.0.1:${port}/processor/healthz`,
    );
    assert.equal(healthResponse.status, 200);
    assert.deepEqual(await healthResponse.json(), { ok: true });

    const collectionResponse = await fetch(
      `http://127.0.0.1:${port}/processor/test-projections`,
    );
    assert.equal(collectionResponse.status, 200);
    const collection = (await collectionResponse.json()) as {
      data: Array<{ eventKey: string }>;
      count: number;
      total: number;
    };
    assert.equal(collection.count, 2);
    assert.equal(collection.total, 2);
    assert.deepEqual(
      new Set(collection.data.map(({ eventKey }) => eventKey)),
      new Set(["first", "second"]),
    );

    const detailResponse = await fetch(
      `http://127.0.0.1:${port}/processor/test-projections/${first.id}`,
    );
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()) as {
      eventKey: string;
      payload: string;
    };
    assert.equal(detail.eventKey, "first");
    assert.equal(detail.payload, "payload-first");

    await server.stop();
    assert.equal(process.listenerCount("SIGINT"), sigintListeners);
    assert.equal(process.listenerCount("SIGTERM"), sigtermListeners);
    assert.equal(dataSource.isInitialized, true);
  });

  it("returns validation or not-found errors and has no mutating routes", async () => {
    dataSource = createInMemoryDataSource("public", [TestProjectionEntity]);
    await dataSource.initialize();
    await dataSource.synchronize();
    const port = await getAvailablePort();
    server = new ProcessorCrudApiServer({
      dataSource,
      port,
      routePrefix: "processor",
      pageLimitDefault: 10,
      pageLimitMax: 20,
      outputEntitySchemas: [TestProjectionEntity],
      readOnly: true,
    });
    await server.start();

    const invalidQueryResponse = await fetch(
      `http://127.0.0.1:${port}/processor/test-projections?limit=invalid`,
    );
    assert.equal(invalidQueryResponse.status, 400);

    const missingResponse = await fetch(
      `http://127.0.0.1:${port}/processor/test-projections/999999`,
    );
    assert.equal(missingResponse.status, 404);

    const createResponse = await fetch(
      `http://127.0.0.1:${port}/processor/test-projections`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventKey: "forbidden",
          payload: "forbidden",
          status: "pending",
        }),
      },
    );
    assert.equal(createResponse.status, 404);

    const patchResponse = await fetch(
      `http://127.0.0.1:${port}/processor/test-projections/1`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "orphaned" }),
      },
    );
    assert.equal(patchResponse.status, 404);
    assert.equal(
      await dataSource.getRepository(TestProjectionEntity).count(),
      0,
    );
  });

  it("rejects invalid construction and entity exposure settings", async () => {
    assert.throws(
      () =>
        new ProcessorCrudApiServer({
          port: 1,
          routePrefix: "processor",
          pageLimitDefault: 21,
          pageLimitMax: 20,
          outputEntitySchemas: [TestProjectionEntity],
          readOnly: true,
        }),
      /pageLimitDefault/,
    );
    assert.throws(
      () =>
        new ProcessorCrudApiServer({
          port: 1,
          routePrefix: "processor",
          pageLimitDefault: 10,
          pageLimitMax: 20,
          outputEntitySchemas: [TestProjectionEntity],
          readOnly: true,
        }),
      /database connection settings/,
    );

    dataSource = createInMemoryDataSource("public", [TestProjectionEntity]);
    await dataSource.initialize();
    await dataSource.synchronize();
    const port = await getAvailablePort();

    server = new ProcessorCrudApiServer({
      dataSource,
      port,
      routePrefix: "processor",
      pageLimitDefault: 10,
      pageLimitMax: 20,
      outputEntitySchemas: [],
      readOnly: true,
    });
    await assert.rejects(server.start(), /at least one output entity/);

    server = new ProcessorCrudApiServer({
      dataSource,
      port,
      routePrefix: "processor",
      pageLimitDefault: 10,
      pageLimitMax: 20,
      outputEntitySchemas: ["not-a-class"],
      readOnly: true,
    });
    await assert.rejects(server.start(), /class-based TypeORM entities/);

    server = new ProcessorCrudApiServer({
      dataSource,
      port,
      routePrefix: "processor",
      pageLimitDefault: 10,
      pageLimitMax: 20,
      outputEntitySchemas: [TestProjectionEntity, TestProjectionEntity],
      readOnly: true,
    });
    await assert.rejects(server.start(), /duplicate route path/);

    const configuredServer = ProcessorCrudApiServer.fromConfig(
      {
        databaseUrl: "postgres://localhost/not-used",
        databaseSchema: "public",
        processorApiPort: port,
        processorApiPrefix: "",
        apiPageLimitDefault: 10,
        apiPageLimitMax: 20,
      },
      [TestProjectionEntity],
    );
    await configuredServer.stop();
  });
});
