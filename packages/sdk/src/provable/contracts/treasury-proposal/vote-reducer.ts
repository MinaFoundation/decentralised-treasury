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

export const VOTE_ACTION_BATCH_SIZE = 5;

export interface VoteReducerContext {
  votingLedger: VotingLedger;
  nullifierLedger: NullifierLedger;
}

export const voteReducerContext = new ContextProvider<VoteReducerContext>();

export class Vote extends Field {
  // DUMMY is an implicit 0
  public static DUMMY = Field(0);
  public static YAY = Field(1);
  public static NAY = Field(2);
  public static ABSTRAIN = Field(3);
}

export class VoteAction extends Struct({
  vote: Vote,
  publicKey: PublicKey,
}) {
  public static isDummy(voteAction: VoteAction) {
    return voteAction.vote
      .equals(Vote.DUMMY)
      .and(voteAction.publicKey.equals(PublicKey.empty()));
  }
  // alias for empty to signal the intention of using empty as batch dummy
  public static dummy() {
    return VoteAction.empty();
  }
}

export class VoteReducerPublicInput extends Struct({
  // TODO: rename to "actionsHash" for both input and output
  fromActionsHash: Field,
  votingLedgerRoot: Field,
  fromNullifierRoot: Field,
}) {}

export class VoteReducerPublicOutput extends Struct({
  toActionsHash: Field,
  toNullifierRoot: Field,
  yay: UInt64,
  nay: UInt64,
  abstain: UInt64,
}) {}

export const voteReducerErrors = {
  VOTING_LEDGER_ROOT_DOES_NOT_MATCH: "Voting ledger root does not match",
  VOTE_HAS_ALREADY_BEEN_NULLIFIED: "Vote has already been nullified",
  INVALID_WITNESS_FOR_THE_VOTE_NULLIFIER:
    "Invalid witness provided for the vote nullifier",
  CALCULATED_NULLIFIER_ROOT_DOES_NOT_MATCH_TO_NULLIFIER_ROOT:
    "Calculated nullifier root does not match toNullifierRoot",
};

export const VoteReducer = ZkProgram({
  name: "vote-reducer",
  publicInput: VoteReducerPublicInput,
  publicOutput: VoteReducerPublicOutput,
  methods: {
    /**
     * Merge two adjacent reduce proofs into a single proof
     */
    merge: {
      privateInputs: [SelfProof, SelfProof],
      method: async (
        publicInput: VoteReducerPublicInput,
        proof1: SelfProof<VoteReducerPublicInput, VoteReducerPublicOutput>,
        proof2: SelfProof<VoteReducerPublicInput, VoteReducerPublicOutput>
      ) => {
        proof1.verify();
        proof2.verify();

        const input1 = proof1.publicInput;
        const output1 = proof1.publicOutput;
        const input2 = proof2.publicInput;
        const output2 = proof2.publicOutput;

        Poseidon.hash(
          VoteReducerPublicInput.toFields(publicInput)
        ).assertEquals(Poseidon.hash(VoteReducerPublicInput.toFields(input1)));

        input1.votingLedgerRoot.assertEquals(input2.votingLedgerRoot);
        output1.toActionsHash.assertEquals(input2.fromActionsHash);
        output1.toNullifierRoot.assertEquals(input2.fromNullifierRoot);

        return {
          publicOutput: {
            toActionsHash: output2.toActionsHash,
            toNullifierRoot: output2.toNullifierRoot,
            yay: output1.yay.add(output2.yay),
            nay: output1.nay.add(output2.nay),
            abstain: output1.abstain.add(output2.abstain),
          },
        };
      },
    },

    reduceBatch: {
      privateInputs: [Provable.Array(VoteAction, VOTE_ACTION_BATCH_SIZE)],
      method: async (
        publicInput: VoteReducerPublicInput,
        voteActions: VoteAction[]
      ) => {
        const context = voteReducerContext.get();

        // alias the input public variables to the output public variables
        // in case of 'rolling state' that changes within the circuit's loop
        let toActionsHash = publicInput.fromActionsHash;
        let toNullifierRoot = publicInput.fromNullifierRoot;

        let yay = UInt64.from(0);
        let nay = UInt64.from(0);
        let abstain = UInt64.from(0);

        // iterate over the vote actions in the batch
        for (let i = 0; i < VOTE_ACTION_BATCH_SIZE; i++) {
          const voteAction = voteActions[i];

          // if its a dummy action (used to fill the static sized batch),
          // ignore its processing outputs down the line
          const isDummyVoteAction = VoteAction.isDummy(voteAction);

          // voting account associated with the vote action
          const votingAccount = await Provable.witnessAsync(
            VotingAccount,
            async () => {
              const votingAccount = await context.votingLedger.getVotingAccount(
                voteAction.publicKey.toBase58()
              );
              return votingAccount;
            }
          );

          // Ensure the witnessed voting account is part of the voting account tree
          const votingAccountWitness = await Provable.witnessAsync(
            PrefixedMerkleWitness256,
            async () => {
              return await context.votingLedger.getWitness(
                voteAction.publicKey.toBase58()
              );
            }
          );

          const votingLedgerRoot = votingAccountWitness.calculateRoot(
            hashWithPrefix(
              votingAccountHashPrefix,
              VotingAccount.toHashInput(votingAccount)
            ),
            votingAccountLedgerHashPrefixes
          );

          const votingLederRootMatches = votingLedgerRoot.equals(
            publicInput.votingLedgerRoot
          );

          // TODO: do we need to constraint this further, as in check both the voting account and the voting action itself are dummies?
          // if the vote action is a dummy, the voting account can be a dummy too so we can ignore it
          votingLederRootMatches
            .or(isDummyVoteAction)
            .assertTrue(voteReducerErrors.VOTING_LEDGER_ROOT_DOES_NOT_MATCH);

          // check that the public key has not yet voted by ensuring the vote nullifier is false
          const voteNullifier = await Provable.witnessAsync(
            Bool,
            async () =>
              await context.nullifierLedger.getNullifier(
                voteAction.publicKey.toBase58()
              )
          );

          const voteNullifierWitness = await Provable.witnessAsync(
            PrefixedMerkleWitness256,
            async () =>
              await context.nullifierLedger.getWitness(
                voteAction.publicKey.toBase58()
              )
          );

          const voteNullifierRoot = voteNullifierWitness.calculateRoot(
            // nullifier is a boolean, so we can use its single field representation
            hashWithPrefix(nullifierHashPrefix, voteNullifier.toFields()),
            nullifierLedgerHashPrefixes
          );
          const voteNullifierIndex = voteNullifierWitness.calculateIndex();

          voteNullifierIndex
            .equals(Poseidon.hash(voteAction.publicKey.toFields()))
            .or(isDummyVoteAction)
            .assertTrue(
              voteReducerErrors.INVALID_WITNESS_FOR_THE_VOTE_NULLIFIER
            );

          // ensure the provided nullifier is indeed part of the nullifier tree
          voteNullifierRoot
            .equals(toNullifierRoot)
            .or(isDummyVoteAction)
            .assertTrue(
              voteReducerErrors.CALCULATED_NULLIFIER_ROOT_DOES_NOT_MATCH_TO_NULLIFIER_ROOT
            );

          // TODO: make this a soft failure, dont count the vote if it has already been nullified
          // we have to make sure the checks here are sufficient given the amount/lack of validation in action dispatch
          // assert that the nullifier has not been used yet
          voteNullifier
            .not()
            .or(isDummyVoteAction)
            .assertTrue(voteReducerErrors.VOTE_HAS_ALREADY_BEEN_NULLIFIED);

          // if the vote action is not a dummy, update the toNullifierRoot by setting the nullifier to true
          // we can't update the nullifier tree root for dummy vote actions, otherwise any further dummies
          // would have their nullifier set to true which would cause errors downstream
          toNullifierRoot = Provable.if(
            isDummyVoteAction,
            toNullifierRoot,
            voteNullifierWitness.calculateRoot(
              hashWithPrefix(nullifierHashPrefix, Bool(true).toFields()),
              nullifierLedgerHashPrefixes
            )
          );

          // TODO: is there a away to call an async external/out-of-circuit dependency without a return value?
          await Provable.witnessAsync(Field, async () => {
            !isDummyVoteAction.toBoolean() &&
              (await context.nullifierLedger.setNullifier(
                voteAction.publicKey.toBase58(),
                Bool(true)
              ));
            return Field(0);
          });

          // update the nullifier tree entry for the vote action's public key
          await Provable.witnessAsync(Field, async () => {
            !isDummyVoteAction.toBoolean() &&
              (await context.nullifierLedger.setLeaf(
                voteAction.publicKey.toBase58(),
                Bool(true)
              ));
            return Field(0);
          });

          // if the vote action is not a dummy, add the vote weight to the respective vote option
          const voteWeight = votingAccount.balance;

          yay = Provable.if(
            voteAction.vote
              .equals(Vote.YAY)
              .and(VoteAction.isDummy(voteAction).not()),
            yay.add(voteWeight),
            yay
          );

          nay = Provable.if(
            voteAction.vote
              .equals(Vote.NAY)
              .and(VoteAction.isDummy(voteAction).not()),
            nay.add(voteWeight),
            nay
          );

          abstain = Provable.if(
            voteAction.vote
              .equals(Vote.ABSTRAIN)
              .and(VoteAction.isDummy(voteAction).not()),
            abstain.add(voteWeight),
            abstain
          );

          // only append non-dummy actions to the hash list
          toActionsHash = Provable.if(
            VoteAction.isDummy(voteAction).not(),
            appendActionToHashList(
              toActionsHash,
              VoteAction.toFields(voteAction)
            ),
            toActionsHash
          );
        }

        return {
          publicOutput: {
            toActionsHash,
            toNullifierRoot,
            yay,
            nay,
            abstain,
          },
        };
      },
    },
  },
});

export class SideLoadedVoteReducerProof extends DynamicProof<
  VoteReducerPublicInput,
  VoteReducerPublicOutput
> {
  static publicInputType = VoteReducerPublicInput;
  static publicOutputType = VoteReducerPublicOutput;
  static maxProofsVerified = 0 as const;
}
