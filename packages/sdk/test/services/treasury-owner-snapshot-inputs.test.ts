import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyvSqlite } from "@keyv/sqlite";
import { Field, PrivateKey, TokenId } from "o1js";
import { Account, packToFields } from "../../src/provable/account.js";
import { hashWithPrefix } from "../../src/provable/hashing-helpers.js";
import {
  accountHashPrefix,
  accountLedgerHashPrefixes,
} from "../../src/ledgers/staking-ledger/staking-ledger.js";
import { PersistentStakingLedger } from "../../src/ledgers/staking-ledger/persistent-staking-ledger.js";
import { createSqliteStakingLedgerStorage } from "../../src/storage/sqlite/factory/sqlite-staking-ledger-storage.js";
import { SqliteTreasuryOwnerService } from "../../src/services/sqlite/sqlite-treasury-owner-service.js";
import { fetchTreasuryOwnerProofInputs } from "../../src/services/fetch-treasury-owner-proof-inputs.js";
import { createTreasurySnapshot } from "../utils/treasury-snapshot.js";

it("selects the default-token Owner and matching witness despite custom-token precedence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "owner-snapshot-"));
  const previousDirectory = process.env.SQLITE_DATA_DIRECTORY;
  process.env.SQLITE_DATA_DIRECTORY = directory;
  const publicKey = PrivateKey.random().toPublicKey();
  const native = (await createTreasurySnapshot(publicKey)).treasuryOwnerAccount;
  const custom = Account.fromJSON(Account.toJSON(native));
  custom.tokenId = Field(9);
  const service = new SqliteTreasuryOwnerService();
  try {
    for (const [id, accounts] of [
      ["0", [custom, native]],
      ["1", [custom]],
    ] as const) {
      const sqlite = new KeyvSqlite({ uri: join(directory, `${id}.sqlite`) });
      const storage = createSqliteStakingLedgerStorage(id, sqlite);
      const ledger = new PersistentStakingLedger(
        storage.accountStorage,
        storage.merkleTreeStorage,
      );
      for (const [index, account] of accounts.entries()) {
        await ledger.setAccount(BigInt(index), account);
        await ledger.setLeaf(BigInt(index), account);
      }
      const root = await ledger.getRoot();
      await ledger.close();
      await sqlite.disconnect();
      if (id === "1") {
        await assert.rejects(
          () =>
            service.getTreasuryOwnerProofInputsFromSqliteStakingLedger(
              id,
              publicKey,
            ),
          /Default-token Treasury Owner account.*was not found/,
        );
      } else {
        const result =
          await service.getTreasuryOwnerProofInputsFromSqliteStakingLedger(
            id,
            publicKey,
          );
        assert.equal(
          result.treasuryOwnerAccount.tokenId.toString(),
          TokenId.default.toString(),
        );
        const leaf = hashWithPrefix(
          accountHashPrefix,
          packToFields(Account.toHashInput(result.treasuryOwnerAccount)),
        );
        assert.equal(
          result.treasuryOwnerAccountWitness
            .calculateRoot(leaf, accountLedgerHashPrefixes)
            .toString(),
          root.toString(),
        );
        assert.equal(
          result.treasuryOwnerAccountWitness.calculateIndex().toBigInt(),
          1n,
        );
      }
    }
  } finally {
    if (previousDirectory === undefined)
      delete process.env.SQLITE_DATA_DIRECTORY;
    else process.env.SQLITE_DATA_DIRECTORY = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

it("fetches the selected account witness and rejects a custom-token API response", async (t) => {
  const publicKey = PrivateKey.random().toPublicKey();
  const snapshot = await createTreasurySnapshot(publicKey);
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    return new Response(
      JSON.stringify(
        url.includes("/accounts/")
          ? { index: "7" }
          : {
              account: Account.toJSON(snapshot.treasuryOwnerAccount),
              witness: snapshot.treasuryOwnerAccountWitness.toJSON(),
            },
      ),
    );
  });
  const inputs = await fetchTreasuryOwnerProofInputs(
    "https://api.example/base/",
    "3",
    publicKey,
  );
  assert.equal(inputs.treasuryOwnerAccount.pk.toBase58(), publicKey.toBase58());
  assert.equal(
    urls[0],
    `https://api.example/base/staking-ledger/lifecycles/3/accounts/${publicKey.toBase58()}?tokenId=1`,
  );
  assert.equal(
    urls[1],
    "https://api.example/base/staking-ledger/lifecycles/3/witnesses/7",
  );
  snapshot.treasuryOwnerAccount.tokenId = Field(9);
  await assert.rejects(
    () => fetchTreasuryOwnerProofInputs("https://api.example", "3", publicKey),
    /token id does not match/,
  );
});
