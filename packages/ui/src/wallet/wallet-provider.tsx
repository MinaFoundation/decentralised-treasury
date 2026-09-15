import type { WalletDetail } from "./wallet-types";

export type { WalletDetail } from "./wallet-types";

export type WalletProviderId = "auro" | "ledger";

export interface WalletSigningReview {
  wallet: "ledger";
  hash: string;
  publicKey: string;
  accountIndex: number;
}

export type WalletSigningReviewHandler = (
  review: WalletSigningReview | null,
) => void;

export interface ZkappSigningRequest {
  transactionJson: string;
  expectedSenderAddress: string;
  minaNodeUrl: string;
  networkId: string;
  fee: string;
  memo: string;
  nonce?: number;
  signal?: AbortSignal;
  onSigningReview?: WalletSigningReviewHandler;
}

export interface ProviderSession {
  providerId: WalletProviderId;
  address: string;
  displayName: string;
  details: WalletDetail[];
  data?: unknown;
}

export interface WalletSigningProvider {
  readonly id: WalletProviderId;
  readonly name: string;
  connect(input?: unknown): Promise<ProviderSession>;
  restore(record: unknown): ProviderSession;
  signZkapp(
    session: ProviderSession,
    request: ZkappSigningRequest,
  ): Promise<unknown>;
  disconnect(session: ProviderSession): Promise<void>;
  subscribe?(
    session: ProviderSession,
    onChange: (session: ProviderSession | null) => void,
  ): (() => void) | void;
}
