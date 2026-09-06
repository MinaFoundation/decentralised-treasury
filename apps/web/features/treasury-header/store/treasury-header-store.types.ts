import type { TreasuryProposalTableEntry } from "@repo/ui/treasury-proposals-table";
import type { WalletConnectButtonProps } from "@repo/ui/wallet-connect-button";
import type { WalletDetail } from "../../wallet/wallet-provider";

export interface TreasuryHeaderSearchState {
  query: string;
  results: TreasuryProposalTableEntry[];
  loading: boolean;
  error: string | null;
}

export interface TreasuryHeaderWalletState {
  loading: boolean;
  status: WalletConnectButtonProps["status"];
  address?: string;
  details?: WalletDetail[];
  accountInfo?: WalletConnectButtonProps["accountInfo"];
  accountInfoLoading: boolean;
  error: string | null;
}

export interface TreasuryHeaderStoreState {
  search: TreasuryHeaderSearchState;
  wallet: TreasuryHeaderWalletState;
}

export interface TreasuryHeaderStoreActions {
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: TreasuryProposalTableEntry[]) => void;
  setSearchLoading: (loading: boolean) => void;
  setSearchError: (error: string | null) => void;
  setWalletState: (wallet: Partial<TreasuryHeaderWalletState>) => void;
  setWalletAccountInfo: (accountInfo: WalletConnectButtonProps["accountInfo"] | undefined) => void;
  setWalletAccountInfoLoading: (loading: boolean) => void;
  reset: () => void;
}

export type TreasuryHeaderStore = TreasuryHeaderStoreState & TreasuryHeaderStoreActions;
