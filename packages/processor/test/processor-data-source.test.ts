import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProcessorDataSource,
  PROCESSOR_INTERNAL_ENTITIES,
} from "../src/index.js";
import { TestProjectionEntity } from "./support/test-projection-entity.js";

describe("createProcessorDataSource", () => {
  it("constructs the PostgreSQL data source without connecting", () => {
    const dataSource = createProcessorDataSource(
      {
        databaseUrl: "postgres://user:pass@localhost/treasury",
        databaseSchema: "processor",
      },
      [TestProjectionEntity, TestProjectionEntity],
    );

    assert.equal(dataSource.isInitialized, false);
    assert.equal(dataSource.options.type, "postgres");
    if (dataSource.options.type !== "postgres") {
      assert.fail("the processor data source must use PostgreSQL");
    }
    assert.equal(
      dataSource.options.url,
      "postgres://user:pass@localhost/treasury",
    );
    assert.equal(dataSource.options.schema, "processor");
    assert.equal(dataSource.options.synchronize, false);
    assert.deepEqual(dataSource.options.entities, [
      ...PROCESSOR_INTERNAL_ENTITIES,
      TestProjectionEntity,
    ]);
  });
});
