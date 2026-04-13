import { create } from "zustand";
import type {
  TreasuryHeaderStore,
  TreasuryHeaderStoreState,
} from "./treasury-header-store.types";

export function createInitialTreasuryHeaderStoreState(): TreasuryHeaderStoreState {
  return {
    search: {
      query: "",
      results: [],
      loading: false,
      error: null,
    },
    wallet: {
      loading: false,
      status: "disconnected",
      isAuroInstalled: undefined,
      address: undefined,
      accountInfo: undefined,
      accountInfoLoading: false,
      error: null,
    },
  };
}

export const initialTreasuryHeaderStoreState = createInitialTreasuryHeaderStoreState();

export const useTreasuryHeaderStore = create<TreasuryHeaderStore>((set) => ({
  ...createInitialTreasuryHeaderStoreState(),
  setSearchQuery: (query) =>
    set((state) => ({
      search: {
        ...state.search,
        query,
      },
    })),
  setSearchResults: (results) =>
    set((state) => ({
      search: {
        ...state.search,
        results,
      },
    })),
  setSearchLoading: (loading) =>
    set((state) => ({
      search: {
        ...state.search,
        loading,
      },
    })),
  setSearchError: (error) =>
    set((state) => ({
      search: {
        ...state.search,
        error,
      },
    })),
  setWalletState: (wallet) =>
    set((state) => ({
      wallet: {
        ...state.wallet,
        ...wallet,
      },
    })),
  setWalletAccountInfo: (accountInfo) =>
    set((state) => ({
      wallet: {
        ...state.wallet,
        accountInfo,
      },
    })),
  setWalletAccountInfoLoading: (accountInfoLoading) =>
    set((state) => ({
      wallet: {
        ...state.wallet,
        accountInfoLoading,
      },
    })),
  reset: () => set(createInitialTreasuryHeaderStoreState()),
}));
