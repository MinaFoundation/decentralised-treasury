import {
  type VerificationKey,
  type PrivateKey,
  type PublicKey,
  type UInt32,
  type UInt64,
} from "o1js";
import { Account } from "../provable/account.js";
import { PrefixedMerkleWitness36 } from "../provable/merkle-tree/prefixed-merkle-tree.js";
import { SideLoadedVoteReducerProof } from "../provable/contracts/treasury-proposal/vote-reducer.js";
import { SideLoadedStakingLedgerToVotingLedgerProof } from "../provable/staking-ledger-to-voting-ledger.js";

export interface CompileTreasuryOwnerOptions {
  proofsEnabled?: boolean;
  lifecyclePeriodDuration?: UInt32;
  cachePath?: string;
}

export interface CompileTreasuryOwnerResult {
  voteReducerVerificationKey: VerificationKey;
  stakingLedgerToVotingLedgerVerificationKey: VerificationKey;
  treasuryProposalVerificationKey: VerificationKey;
  treasuryPauseControllerVerificationKey: VerificationKey;
  treasuryOwnerVerificationKey: VerificationKey;
}

export interface DeployTreasuryOwnerOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPrivateKey: PrivateKey;
  pauseControllerPrivateKey: PrivateKey;
  treasuryDeployedAtSlot: UInt32;
  multisigParticipantsPublicKeys: PublicKey[];
  allowDeployToExistingAccount?: boolean;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait?: boolean;
  lightnetAccountManagerEndpoint?: string;
}

export interface DeployTreasuryOwnerResult {
  pauseControllerAddress: string;
  treasuryOwnerAddress: string;
  pauseControllerTxHash?: string;
  treasuryOwnerTxHash?: string;
}

export interface CreateTreasuryProposalOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  proposalPrivateKey: PrivateKey;
  proposalLifecycleId: UInt32;
  recipientPublicKey: PublicKey;
  amount: UInt64;
  proposalZkappUri: string;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait?: boolean;
}

export interface CreateTreasuryProposalResult {
  proposalAddress: string;
  proposalTokenId: string;
  proposalTxHash?: string;
}

export type ProposalVote = "yay" | "nay" | "abstain";

export interface VoteTreasuryProposalOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  voterPrivateKey: PrivateKey;
  vote: ProposalVote;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait?: boolean;
}

export interface VoteTreasuryProposalResult {
  proposalAddress: string;
  voteTxHash?: string;
}

export interface TallyVotesTreasuryProposalOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  voteReducerProof: SideLoadedVoteReducerProof;
  stakingLedgerToVotingLedgerProof: SideLoadedStakingLedgerToVotingLedgerProof;
  treasuryOwnerAccount: Account;
  treasuryOwnerAccountWitness: PrefixedMerkleWitness36;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait?: boolean;
}

export interface TallyVotesTreasuryProposalResult {
  proposalAddress: string;
  tallyTxHash?: string;
}

export interface ExecuteTreasuryProposalOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  recipientPublicKey: PublicKey;
  amountToPayOut?: UInt64;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait?: boolean;
}

export interface ExecuteTreasuryProposalResult {
  proposalAddress: string;
  recipientPublicKey: string;
  amountToPayOut: string;
  executeTxHash?: string;
}

export interface TransferToTreasuryOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  fundingPrivateKey?: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  amount: UInt64;
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait?: boolean;
}

export interface TransferToTreasuryResult {
  sender: string;
  fundingAccount: string;
  from: string;
  to: string;
  amount: string;
  transferTxHash?: string;
}

export interface GetTreasuryOwnerStateOptions {
  minaNodeUrl: string;
  treasuryOwnerPublicKey: PublicKey;
}

export interface GetTreasuryOwnerStateResult {
  treasuryOwnerAddress: string;
  treasuryOwnerTokenId: string;
  treasuryDeployedAtSlot: string;
  pauseControllerPublicKey: string;
}

export interface GetTreasuryProposalStateOptions {
  minaNodeUrl: string;
  treasuryOwnerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
}

export interface GetTreasuryProposalStateResult {
  proposalAddress: string;
  recipientHash: string;
  amount: string;
  lifecycleId: string;
  stakingEpochDataLedgerHash: string;
  stakingEpochDataLedgerTotalCurrency: string;
  status: string;
  statusField: string;
  paidOutAmount: string;
}

export type LifecyclePeriodName =
  | "proposal"
  | "exploration"
  | "voting"
  | "cooldown";

export interface GetCurrentLifecyclePeriodOptions {
  minaNodeUrl: string;
  treasuryOwnerPublicKey: PublicKey;
  lifecyclePeriodDuration?: UInt32;
}

export interface GetCurrentLifecyclePeriodResult {
  treasuryOwnerAddress: string;
  currentGlobalSlot: string;
  treasuryDeployedAtSlot: string;
  lifecyclePeriodDuration: string;
  lifecycleStarted: boolean;
  lifecycleId: string;
  period: LifecyclePeriodName;
  periodStartSlot: string;
  periodEndSlot: string;
}

export interface TreasuryOwnerService {
  compile(
    options?: CompileTreasuryOwnerOptions,
  ): Promise<CompileTreasuryOwnerResult>;
  deploy(options: DeployTreasuryOwnerOptions): Promise<DeployTreasuryOwnerResult>;
  createProposal(
    options: CreateTreasuryProposalOptions,
  ): Promise<CreateTreasuryProposalResult>;
  voteProposal(
    options: VoteTreasuryProposalOptions,
  ): Promise<VoteTreasuryProposalResult>;
  tallyVotes(
    options: TallyVotesTreasuryProposalOptions,
  ): Promise<TallyVotesTreasuryProposalResult>;
  executeProposal(
    options: ExecuteTreasuryProposalOptions,
  ): Promise<ExecuteTreasuryProposalResult>;
  transferToTreasury(
    options: TransferToTreasuryOptions,
  ): Promise<TransferToTreasuryResult>;
  getTreasuryOwnerState(
    options: GetTreasuryOwnerStateOptions,
  ): Promise<GetTreasuryOwnerStateResult>;
  getProposalState(
    options: GetTreasuryProposalStateOptions,
  ): Promise<GetTreasuryProposalStateResult>;
  getCurrentLifecyclePeriod(
    options: GetCurrentLifecyclePeriodOptions,
  ): Promise<GetCurrentLifecyclePeriodResult>;
}
