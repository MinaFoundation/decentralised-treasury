import { it } from "node:test";
import {
  SideLoadedStakingLedgerToVotingLedgerProof,
  StakingLedgerToVotingLedger,
  StakingLedgerToVotingLedgerProgramInput,
  StakingLedgerToVotingLedgerProgramOutput,
} from "../../../src/provable/staking-ledger-to-voting-ledger.js";
import { StakingLedgerToVotingLedgerMergeTask } from "../../../src/proving/tasks/staking-ledger-to-voting-ledger-merge-task.js";

it("should run the merge task with two proofs", async () => {
  const input1 = StakingLedgerToVotingLedgerProgramInput.empty();
  const output1 = StakingLedgerToVotingLedgerProgramOutput.empty();

  // TODO: replace with real proofs loaded from a file, in order to test merging with proofs enabled
  const proof1 = await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
    input1,
    output1,
    0
  );

  const input2 = {
    ...StakingLedgerToVotingLedgerProgramInput.empty(),
    index: output1.index.add(1),
  };
  const output2 = StakingLedgerToVotingLedgerProgramOutput.empty();

  const proof2 = await SideLoadedStakingLedgerToVotingLedgerProof.dummy(
    input2,
    output2,
    0
  );

  await StakingLedgerToVotingLedgerMergeTask.prepare();

  await StakingLedgerToVotingLedgerMergeTask.run({
    proofs: {
      1: await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
        proof1.toJSON()
      ),
      2: await SideLoadedStakingLedgerToVotingLedgerProof.fromJSON(
        proof2.toJSON()
      ),
    },
  });
});
