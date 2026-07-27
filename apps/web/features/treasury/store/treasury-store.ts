import { create } from "zustand";
import type { TreasuryState, TreasuryStore } from "./treasury-store.types";

export const initialTreasuryState: TreasuryState = {
  paused: false,
  balance: undefined,
  currentLifecycleId: undefined,
  lifecycleStarted: undefined,
  currentPeriod: undefined,
  currentPeriodProgress: undefined,
  currentGlobalSlot: undefined,
  treasuryDeployedAtSlot: undefined,
  loading: true,
  error: null,
  health: {
    nodeBlockHeight: null,
    nodeFresh: false,
    archiveBlockHeight: null,
    archiveFresh: false,
    indexerBlockHeight: null,
    indexerFresh: false,
    processorRemainingEvents: null,
    processorFresh: false,
    updatedAt: null,
  },
};

export const useTreasuryStore = create<TreasuryStore>((set) => ({
  ...initialTreasuryState,
  setTreasuryState: (treasury) =>
    set((state) => ({
      ...state,
      ...treasury,
    })),
  reset: () => set(initialTreasuryState),
}));
