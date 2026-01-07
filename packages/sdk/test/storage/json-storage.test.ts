import { it } from "node:test";
import { Field, Struct } from "o1js";
import {
  JsonStorage,
  Serializable,
} from "src/storage/staking-ledger-to-voting-ledger-proof-storage.js";

class TestSerializable extends Struct({
  foo: Field,
}) {}

class TestJsonStorage implements JsonStorage<typeof TestSerializable> {
  async getJSON(id: string): Promise<TestSerializable | undefined> {
    return new TestSerializable({
      foo: Field(1),
    });
  }
  // setJSON(
  //   id: string,
  //   serializable: Serializable
  // ): Promise<void> {
  //   return void 0;
  // }
  // close(): Promise<void> {
  //   throw new Error("Method not implemented.");
  // }
}

// it("should store and retrieve a json object", async () => {
//   const storage = new TestJsonStorage();
//   const serializable = new TestSerializable({
//     foo: Field(1),
//   });
//   await storage.setJSON("test", serializable);
// });
