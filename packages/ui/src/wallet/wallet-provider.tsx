import type { WalletDetail } from "./wallet-types";

export type { WalletDetail } from "./wallet-types";

export type WalletProviderId = "auro" | "ledger";

export interface ZkappSigningRequest {
  transactionJson: string;
  expectedSenderAddress: string;
  minaNodeUrl: string;
  networkId: string;
  fee: string;
  memo: string;
  nonce?: number;
  signal?: AbortSignal;
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
