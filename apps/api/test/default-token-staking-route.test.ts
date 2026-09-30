import assert from "node:assert/strict";
import { it } from "node:test";
import { Field, PrivateKey } from "o1js";
import { Account } from "@repo/sdk/src/provable/account.js";
import { createStakingLedgerWitnessRoutes } from "../src/staking-ledger/staking-ledger-witness-routes.js";

it("selects only the default-token account when creation requests tokenId=1", async () => {
  const publicKey = PrivateKey.random().toPublicKey();
  const native = Account.empty();
  native.pk = publicKey;
  const custom = Account.fromJSON(Account.toJSON(native));
  custom.tokenId = Field(9);
  let accounts = [custom, native];
  const handlers = new Map<
    string,
    (request: any, response: any) => Promise<void>
  >();
  const routes = createStakingLedgerWitnessRoutes({
    stakingLedgerServices: {
      getService: async () => ({ getAllAccounts: async () => accounts }),
    } as never,
  });
  routes({
    get: (path: string, handler: any) => handlers.set(path, handler),
  } as never);
  const handler = handlers.get(
    "/staking-ledger/lifecycles/:lifecycleId/accounts/:publicKey",
  )!;
  let status = 200;
  let payload: any;
  const response = {
    status: (value: number) => {
      status = value;
      return response;
    },
    json: (value: any) => {
      payload = value;
    },
  };
  const request = {
    params: { lifecycleId: "0", publicKey: publicKey.toBase58() },
    query: { tokenId: "1" },
  };
  await handler(request, response);
  assert.equal(status, 200);
  assert.equal(payload.index, "1");
  assert.equal(Account.fromJSON(payload.account).tokenId.toString(), "1");
  accounts = [custom];
  await handler(request, response);
  assert.equal(status, 404);
  request.query.tokenId = "9";
  await handler(request, response);
  assert.equal(status, 400);
});
