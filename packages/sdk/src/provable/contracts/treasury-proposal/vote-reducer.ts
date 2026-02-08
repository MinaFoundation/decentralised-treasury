import {
  Bool,
  DynamicProof,
  Field,
  Poseidon,
  Provable,
  PublicKey,
  SelfProof,
  Struct,
  UInt64,
  ZkProgram,
} from "o1js";
import { appendActionToHashList } from "../../hashing-helpers.js";
import { hashWithPrefix } from "../../hashing-helpers.js";
import { ContextProvider } from "../../../utils/context-provider.js";
import {
  votingAccountLedgerHashPrefixes,
  votingAccountHashPrefix,
  VotingLedger,
} from "../../../ledgers/voting-ledger/voting-ledger.js";
import { VotingAccount } from "../../voting-account.js";
import { PrefixedMerkleWitness256 } from "../../merkle-tree/prefixed-merkle-tree.js";
import {
  nullifierLedgerHashPrefixes,
  nullifierHashPrefix,
  NullifierLedger,
} from "../../../ledgers/nullifier-ledger/nullifier-ledger.js";

// number of vote actions processed per reduce batch.
export const VOTE_ACTION_BATCH_SIZE = 5;

/**
 * In-circuit context dependencies for reading/writing ledgers.
 * Supplied off-circuit and witnessed when used.
 */
export interface VoteReducerContext {
  votingLedger: VotingLedger;
  nullifierLedger: NullifierLedger;
}

// shared context provider for the vote reducer program.
export const voteReducerContext = new ContextProvider<VoteReducerContext>();

/**
 * Vote enum modeled as a Field for circuit usage.
 */
export class Vote extends Field {
  // DUMMY is an implicit 0.
  public static DUMMY = new Vote(0);
  public static YAY = new Vote(1);
  public static NAY = new Vote(2);
  public static ABSTRAIN = new Vote(3);

  /**
   * Ensure the vote is a known enum value.
   *
   * @returns Asserts when the vote is invalid.
   */
  public static assertValid(vote: Vote) {
    vote
      .equals(Vote.YAY)
      .or(vote.equals(Vote.NAY))
      .or(vote.equals(Vote.ABSTRAIN))
      .or(vote.equals(Vote.DUMMY))
      .assertTrue("Invalid vote");
  }
}

/**
 * Vote action emitted by the proposal contract.
 */
export class VoteAction extends Struct({
  vote: Vote,
  publicKey: PublicKey,
}) {
  /**
   * True when the action is used as padding in a fixed batch.
   *
   * @param voteAction - Candidate vote action to inspect.
   * @returns True when the action is dummy padding.
   */
  public static isDummy(voteAction: VoteAction) {
    return voteAction.vote
      .equals(Vote.DUMMY)
      .and(voteAction.publicKey.equals(PublicKey.empty()));
  }

  /**
   * Create a dummy action for batch padding.
   *
   * @returns Dummy vote action with empty public key.
   */
  public static dummy() {
    return new VoteAction({ vote: Vote.DUMMY, publicKey: PublicKey.empty() });
  }

  /**
   * Deserialize a vote action, defaulting to empty on error.
   *
   * @param json - Raw JSON payload.
   * @returns Parsed vote action or empty action on error.
   */
  public static fromJSON(json: Record<string, any>): VoteAction {
    let voteAction: VoteAction;
    try {
      voteAction = super.fromJSON(json as any);
    } catch (error) {
      Provable.log("error deserializing vote action", error);
      voteAction = VoteAction.empty();
    }
    return voteAction;
  }
}
/**
 * Tracks up to five action state hashes and whether each has been seen.
 */
export class ActionStateHistory extends Struct({
  actionStateOne: {
    hash: Field,
    found: Bool,
  },
  actionStateTwo: {
    hash: Field,
    found: Bool,
  },
  actionStateThree: {
    hash: Field,
    found: Bool,
  },
  actionStateFour: {
    hash: Field,
    found: Bool,
  },
  actionStateFive: {
    hash: Field,
    found: Bool,
  },
}) {
  /**
   * Clone a history instance to avoid mutating the original.
   *
   * @param actionStateHistory - History instance to clone.
   * @returns Cloned action state history.
   */
  public static clone(actionStateHistory: ActionStateHistory) {
    return new ActionStateHistory({
      actionStateOne: {
        hash: actionStateHistory.actionStateOne.hash,
        found: actionStateHistory.actionStateOne.found,
      },
      actionStateTwo: {
        hash: actionStateHistory.actionStateTwo.hash,
        found: actionStateHistory.actionStateTwo.found,
      },
      actionStateThree: {
        hash: actionStateHistory.actionStateThree.hash,
        found: actionStateHistory.actionStateThree.found,
      },
      actionStateFour: {
        hash: actionStateHistory.actionStateFour.hash,
        found: actionStateHistory.actionStateFour.found,
      },
      actionStateFive: {
        hash: actionStateHistory.actionStateFive.hash,
        found: actionStateHistory.actionStateFive.found,
      },
    });
  }
}

/**
 * Public inputs for the vote reducer program.
 */
export class VoteReducerPublicInput extends Struct({
  fromActionsHash: Field,
  votingLedgerRoot: Field,
  fromNullifierRoot: Field,
  actionStateHistory: ActionStateHistory,
}) {
  /**
   * Clone the input so rolling state mutations don't affect the caller.
   *
   * @param publicInput - Public input to clone.
   * @returns Cloned public input.
   */
  public static clone(publicInput: VoteReducerPublicInput) {
    return new VoteReducerPublicInput({
      fromActionsHash: publicInput.fromActionsHash,
      votingLedgerRoot: publicInput.votingLedgerRoot,
      fromNullifierRoot: publicInput.fromNullifierRoot,
      actionStateHistory: ActionStateHistory.clone(
        publicInput.actionStateHistory,
      ),
    });
  }
}

/**
 * Public outputs for the vote reducer program.
 */
export class VoteReducerPublicOutput extends Struct({
  toActionsHash: Field,
  toNullifierRoot: Field,
  yay: UInt64,
  nay: UInt64,
  abstain: UInt64,
  actionStateHistory: ActionStateHistory,
}) {}

// errors surfaced by vote reducer constraints.
export const voteReducerErrors = {
  VOTING_LEDGER_ROOT_DOES_NOT_MATCH: "Voting ledger root does not match",
  VOTE_HAS_ALREADY_BEEN_NULLIFIED: "Vote has already been nullified",
  INVALID_WITNESS_FOR_THE_VOTE_NULLIFIER:
    "Invalid witness provided for the vote nullifier",
  CALCULATED_NULLIFIER_ROOT_DOES_NOT_MATCH_TO_NULLIFIER_ROOT:
    "Calculated nullifier root does not match toNullifierRoot",
  VOTING_ACCOUNT_INDEX_DOES_NOT_MATCH: "Voting account index does not match",
};

/**
 * ZkProgram to reduce vote actions in fixed-size batches and merge proofs.
 */
export const VoteReducer = ZkProgram({
  name: "vote-reducer",
  publicInput: VoteReducerPublicInput,
  publicOutput: VoteReducerPublicOutput,
  methods: {
    /**
     * Merge two adjacent reduce proofs into a single proof
     *
     * @param publicInput - Expected public input for the merged proof.
     * @param proof1 - First proof in the sequence.
     * @param proof2 - Second proof in the sequence.
     * @returns Merged public output containing combined tallies.
     */
    merge: {
      privateInputs: [SelfProof, SelfProof],
      method: async (
        publicInput: VoteReducerPublicInput,
        proof1: SelfProof<VoteReducerPublicInput, VoteReducerPublicOutput>,
        proof2: SelfProof<VoteReducerPublicInput, VoteReducerPublicOutput>,
      ) => {
        proof1.verify();
        proof2.verify();

        // alias inputs/outputs for readability.
        const input1 = proof1.publicInput;
        const output1 = proof1.publicOutput;
        const input2 = proof2.publicInput;
        const output2 = proof2.publicOutput;

        Poseidon.hash(
          VoteReducerPublicInput.toFields(publicInput),
        ).assertEquals(
          Poseidon.hash(VoteReducerPublicInput.toFields(input1)),
          "Vote reducer merge public input does not match first proof input",
        );

        // ensure the proofs are contiguous and operate on the same roots.
        input1.votingLedgerRoot.assertEquals(
          input2.votingLedgerRoot,
          "Voting ledger root does not match between merged proofs",
        );
        output1.toActionsHash.assertEquals(
          input2.fromActionsHash,
          "Action hash chain is not contiguous between merged proofs",
        );
        output1.toNullifierRoot.assertEquals(
          input2.fromNullifierRoot,
          "Nullifier root does not match between merged proofs",
        );

        // merge action state history by preferring the older proof's found flags.
        const actionStateHistory = ActionStateHistory.clone(
          input1.actionStateHistory,
        );
        for (const actionStateKey of Object.keys(input1.actionStateHistory)) {
          const output1ActionState: ActionStateHistory[keyof ActionStateHistory] =
            output1.actionStateHistory[
              actionStateKey as keyof ActionStateHistory
            ];
          const output2ActionState: ActionStateHistory[keyof ActionStateHistory] =
            output2.actionStateHistory[
              actionStateKey as keyof ActionStateHistory
            ];

          // if the older proof has already found the action state hash, use that.
          // otherwise, use the newer proof's found status, assuming the newer proof
          // will find the latter action state hashes as it progresses through the batches.
          actionStateHistory[actionStateKey as keyof ActionStateHistory].found =
            Provable.if(
              output1ActionState.found,
              output1ActionState.found,
              output2ActionState.found,
            );
        }

        return {
          publicOutput: {
            toActionsHash: output2.toActionsHash,
            toNullifierRoot: output2.toNullifierRoot,
            yay: output1.yay.add(output2.yay),
            nay: output1.nay.add(output2.nay),
            abstain: output1.abstain.add(output2.abstain),
            actionStateHistory,
          },
        };
      },
    },

    /**
     * Reduce a fixed-size batch of vote actions into tallies and updated roots.
     *
     * @param publicInput - Public input for this batch reduction.
     * @param voteActions - Fixed-size batch of vote actions.
     * @returns Public output with updated hashes and tallies.
     */
    reduceBatch: {
      privateInputs: [Provable.Array(VoteAction, VOTE_ACTION_BATCH_SIZE)],
      method: async (
        publicInput: VoteReducerPublicInput,
        voteActions: VoteAction[],
      ) => {
        const context = voteReducerContext.get();

        // alias the input public variables to the output public variables
        // in case of 'rolling state' that changes within the circuit's loop.
        let toActionsHash = publicInput.fromActionsHash;
        let toNullifierRoot = publicInput.fromNullifierRoot;
        let actionStateHistory = ActionStateHistory.clone(
          publicInput.actionStateHistory,
        );

        // start every batch with a zeroed tally.
        let yay = UInt64.from(0);
        let nay = UInt64.from(0);
        let abstain = UInt64.from(0);

        // iterate over the vote actions in the batch.
        for (let i = 0; i < VOTE_ACTION_BATCH_SIZE; i++) {
          const voteAction = voteActions[i];
          Vote.assertValid(voteAction.vote);

          // if its a dummy action (used to fill the static sized batch),
          // ignore its processing outputs down the line.
          const isDummyVoteAction = VoteAction.isDummy(voteAction);

          // voting account associated with the vote action.
          const votingAccount = await Provable.witnessAsync(
            VotingAccount,
            async () => {
              const votingAccount = await context.votingLedger.getVotingAccount(
                voteAction.publicKey.toBase58(),
              );
              return votingAccount;
            },
          );

          // ensure the witnessed voting account is part of the voting account tree.
          const votingAccountWitness = await Provable.witnessAsync(
            PrefixedMerkleWitness256,
            async () => {
              return await context.votingLedger.getWitness(
                voteAction.publicKey.toBase58(),
              );
            },
          );

          // calculate and verify the voting ledger root and index.
          const votingLedgerRoot = votingAccountWitness.calculateRoot(
            hashWithPrefix(
              votingAccountHashPrefix,
              VotingAccount.toHashInput(votingAccount),
            ),
            votingAccountLedgerHashPrefixes,
          );

          const votingLederRootMatches = votingLedgerRoot.equals(
            publicInput.votingLedgerRoot,
          );

          const votingAccountIndex = votingAccountWitness.calculateIndex();
          const votingAccountIndexMatches = votingAccountIndex.equals(
            Poseidon.hash(voteAction.publicKey.toFields()),
          );

          votingAccountIndexMatches.assertTrue(
            voteReducerErrors.VOTING_ACCOUNT_INDEX_DOES_NOT_MATCH,
          );
          // TODO: do we need to constraint this further, as in check both the voting account and the voting action itself are dummies?
          // if the vote action is a dummy, the voting account can be a dummy too so we can ignore it.
          votingLederRootMatches.assertTrue(
            voteReducerErrors.VOTING_LEDGER_ROOT_DOES_NOT_MATCH,
          );

          // check that the public key has not yet voted by ensuring the vote nullifier is false.
          const voteNullifier = await Provable.witnessAsync(
            Bool,
            async () =>
              await context.nullifierLedger.getNullifier(
                voteAction.publicKey.toBase58(),
              ),
          );

          const voteNullifierWitness = await Provable.witnessAsync(
            PrefixedMerkleWitness256,
            async () =>
              await context.nullifierLedger.getWitness(
                voteAction.publicKey.toBase58(),
              ),
          );

          const voteNullifierRoot = voteNullifierWitness.calculateRoot(
            // nullifier is a boolean, so we can use its single field representation.
            hashWithPrefix(nullifierHashPrefix, voteNullifier.toFields()),
            nullifierLedgerHashPrefixes,
          );
          const voteNullifierIndex = voteNullifierWitness.calculateIndex();

          voteNullifierIndex
            .equals(Poseidon.hash(voteAction.publicKey.toFields()))
            .assertTrue(
              voteReducerErrors.INVALID_WITNESS_FOR_THE_VOTE_NULLIFIER,
            );

          // ensure the provided nullifier is indeed part of the nullifier tree.
          voteNullifierRoot
            .equals(toNullifierRoot)
            .assertTrue(
              voteReducerErrors.CALCULATED_NULLIFIER_ROOT_DOES_NOT_MATCH_TO_NULLIFIER_ROOT,
            );

          // if the vote action is not a dummy, update the toNullifierRoot by setting the nullifier to true.
          // we can't update the nullifier tree root for dummy vote actions, otherwise any further dummies
          // would have their nullifier set to true which would cause errors downstream.
          toNullifierRoot = Provable.if(
            isDummyVoteAction,
            toNullifierRoot,
            voteNullifierWitness.calculateRoot(
              hashWithPrefix(nullifierHashPrefix, Bool(true).toFields()),
              nullifierLedgerHashPrefixes,
            ),
          );

          // TODO: is there a away to call an async external/out-of-circuit dependency without a return value?
          await Provable.witnessAsync(Field, async () => {
            !isDummyVoteAction.toBoolean() &&
              (await context.nullifierLedger.setNullifier(
                voteAction.publicKey.toBase58(),
                Bool(true),
              ));
            return Field(0);
          });

          // update the nullifier tree entry for the vote action's public key.
          await Provable.witnessAsync(Field, async () => {
            !isDummyVoteAction.toBoolean() &&
              (await context.nullifierLedger.setLeaf(
                voteAction.publicKey.toBase58(),
                Bool(true),
              ));
            return Field(0);
          });

          // if the vote action is not a dummy or the vote has not yet been nullified, add the vote weight to the respective vote option.
          const voteWeight = Provable.if(
            isDummyVoteAction.or(voteNullifier),
            UInt64.from(0),
            votingAccount.balance,
          );

          yay = Provable.if(
            voteAction.vote.equals(Vote.YAY),
            yay.add(voteWeight),
            yay,
          );

          nay = Provable.if(
            voteAction.vote.equals(Vote.NAY),
            nay.add(voteWeight),
            nay,
          );

          abstain = Provable.if(
            voteAction.vote.equals(Vote.ABSTRAIN),
            abstain.add(voteWeight),
            abstain,
          );

          // only append non-dummy actions to the hash list.
          toActionsHash = Provable.if(
            isDummyVoteAction,
            toActionsHash,
            appendActionToHashList(
              toActionsHash,
              VoteAction.toFields(voteAction),
            ),
          );

          for (const actionStateKey of Object.keys(actionStateHistory)) {
            // TODO: this could be typed better
            const actionState: ActionStateHistory["actionStateOne"] =
              actionStateHistory[actionStateKey];
            const found = toActionsHash.equals(actionState.hash);

            // the hash that has already been found should not be found again.
            actionState.found
              .and(found)
              .and(isDummyVoteAction.not())
              .assertFalse(
                "action state hash has been previously found, cannot be found again",
              );
            actionStateHistory[
              actionStateKey as keyof ActionStateHistory
            ].found = Provable.if(found, found, actionState.found);
          }
        }

        return {
          publicOutput: {
            toActionsHash,
            toNullifierRoot,
            yay,
            nay,
            abstain,
            actionStateHistory,
          },
        };
      },
    },
  },
});

/**
 * Side-loaded proof type for external verification contexts.
 */
export class SideLoadedVoteReducerProof extends DynamicProof<
  VoteReducerPublicInput,
  VoteReducerPublicOutput
> {
  static publicInputType = VoteReducerPublicInput;
  static publicOutputType = VoteReducerPublicOutput;
  static maxProofsVerified = 2 as const;
}

/**
 * Proof class alias generated by the ZkProgram.
 */
export class VoteReducerProof extends VoteReducer.Proof {}
