import { it } from "node:test";
import { RedisMemoryServer } from "redis-memory-server";
import { RedisStakingLedgerToVotingLedgerProofStorage } from "../../../src/storage/redis/redis-staking-ledger-to-voting-ledger-proof-storage.js";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { Provable } from "o1js";

it("should store a proof", async () => {
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  const proofStorage = new RedisStakingLedgerToVotingLedgerProofStorage(
    redisUrl,
    "test-namespace"
  );

  const proof = await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
    StakingLedgerToVotingLedgerProgramInput.empty(),
    StakingLedgerToVotingLedgerProgramOutput.empty(),
    0
  );
  await proofStorage.setProof("test-id", proof);

  const storedProof = await proofStorage.getProof("test-id");
  Provable.log("storedProof", storedProof);
});
