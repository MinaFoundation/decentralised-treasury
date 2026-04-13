import type {
  PrivateKey,
  PublicKey,
  UInt64,
  VerificationKey,
} from "o1js";
import type { MultisigSignatures } from "../provable/contracts/treasury-pause-controller/multisig-signatures.js";

export interface CompilePauseControllerOptions {
  proofsEnabled?: boolean;
  cachePath?: string;
}

export interface CompilePauseControllerResult {
  pauseControllerVerificationKey: VerificationKey;
}

export interface DeployPauseControllerOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  pauseControllerPrivateKey: PrivateKey;
  multisigParticipantsPublicKeys: PublicKey[];
  fee?: UInt64;
  nonce?: number;
  memo?: string;
  wait?: boolean;
}

export interface DeployPauseControllerResult {
  pauseControllerAddress: string;
  pauseControllerTxHash?: string;
}

export interface PauseTreasuryOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  pauseControllerPublicKey: PublicKey;
  multisigParticipantsPublicKeys: PublicKey[];
  signatures: MultisigSignatures;
  nonce?: number;
  fee?: UInt64;
  memo?: string;
  wait?: boolean;
}

export interface PauseTreasuryResult {
  pauseControllerAddress: string;
  paused: true;
  nonce: string;
  pauseTxHash?: string;
}

export interface UnpauseTreasuryOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  pauseControllerPublicKey: PublicKey;
  multisigParticipantsPublicKeys: PublicKey[];
  signatures: MultisigSignatures;
  nonce?: number;
  fee?: UInt64;
  memo?: string;
  wait?: boolean;
}

export interface UnpauseTreasuryResult {
  pauseControllerAddress: string;
  paused: false;
  nonce: string;
  unpauseTxHash?: string;
}

export interface TogglePauseProposalOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  treasuryOwnerPublicKey: PublicKey;
  pauseControllerPublicKey: PublicKey;
  proposalPublicKey: PublicKey;
  multisigParticipantsPublicKeys: PublicKey[];
  signatures: MultisigSignatures;
  nonce?: number;
  fee?: UInt64;
  memo?: string;
  wait?: boolean;
}

export interface TogglePauseProposalResult {
  treasuryOwnerAddress: string;
  pauseControllerAddress: string;
  proposalPublicKey: string;
  nonce: string;
  togglePauseProposalTxHash?: string;
}

export interface RotateMultisigKeysOptions {
  minaNodeUrl: string;
  senderPrivateKey: PrivateKey;
  pauseControllerPublicKey: PublicKey;
  currentMultisigParticipantsPublicKeys: PublicKey[];
  signatures: MultisigSignatures;
  newMultisigParticipantsPublicKeys: PublicKey[];
  nonce?: number;
  fee?: UInt64;
  memo?: string;
  wait?: boolean;
}

export interface RotateMultisigKeysResult {
  pauseControllerAddress: string;
  nonce: string;
  previousMultisigCommitment: string;
  newMultisigCommitment: string;
  rotateMultisigKeysTxHash?: string;
}

export interface GetPauseControllerStateOptions {
  minaNodeUrl: string;
  pauseControllerPublicKey: PublicKey;
}

export interface GetPauseControllerStateResult {
  pauseControllerAddress: string;
  multisigCommitment: string;
  paused: boolean;
  nonce: string;
}

export interface PauseControllerService {
  compile(
    options?: CompilePauseControllerOptions,
  ): Promise<CompilePauseControllerResult>;
  deploy(options: DeployPauseControllerOptions): Promise<DeployPauseControllerResult>;
  pauseTreasury(options: PauseTreasuryOptions): Promise<PauseTreasuryResult>;
  unpauseTreasury(options: UnpauseTreasuryOptions): Promise<UnpauseTreasuryResult>;
  togglePauseProposal(
    options: TogglePauseProposalOptions,
  ): Promise<TogglePauseProposalResult>;
  rotateMultisigKeys(
    options: RotateMultisigKeysOptions,
  ): Promise<RotateMultisigKeysResult>;
  getPauseControllerState(
    options: GetPauseControllerStateOptions,
  ): Promise<GetPauseControllerStateResult>;
}

