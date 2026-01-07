import { Poseidon, Struct, UInt64 } from "o1js";

// TODO: its not sufficient to create empty voting accounts with the current structure, what if the voting account simply has 0 balance?
// TODO: could have just been UInt64, but maybe we'll need more information later in the implementation?
export class VotingAccount extends Struct({
  balance: UInt64,
}) {
  public static isEmpty(votingAccount: VotingAccount) {
    return Poseidon.hash(VotingAccount.toFields(votingAccount)).equals(
      Poseidon.hash(VotingAccount.toFields(VotingAccount.empty()))
    );
  }

  public static toHashInput(votingAccount: VotingAccount) {
    return VotingAccount.toFields(votingAccount);
  }
}
