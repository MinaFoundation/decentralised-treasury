import { useTreasuryHeaderStore } from "./treasury-header-store";

export const useHeaderSearchState = () => useTreasuryHeaderStore((state) => state.search);
export const useHeaderWalletState = () => useTreasuryHeaderStore((state) => state.wallet);
