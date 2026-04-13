import { create } from "zustand";

export interface MinaBlockSnapshot {
  latestBlockHeight: number | null;
  latestBlockHash: string | null;
  polling: boolean;
  lastCheckedAt: number | null;
  error: string | null;
  refreshToken: number;
}

interface MinaBlockActions {
  setPolling: (polling: boolean) => void;
  setError: (error: string | null) => void;
  recordCheck: () => void;
  registerBlock: (snapshot: { height: number; hash: string | null }) => void;
  forceRefresh: () => void;
  reset: () => void;
}

export type MinaBlockStore = MinaBlockSnapshot & MinaBlockActions;

export const initialMinaBlockState: MinaBlockSnapshot = {
  latestBlockHeight: null,
  latestBlockHash: null,
  polling: false,
  lastCheckedAt: null,
  error: null,
  refreshToken: 0,
};

export const useMinaBlockStore = create<MinaBlockStore>((set) => ({
  ...initialMinaBlockState,
  setPolling: (polling) => set(() => ({ polling })),
  setError: (error) => set(() => ({ error })),
  recordCheck: () => set(() => ({ lastCheckedAt: Date.now() })),
  registerBlock: ({ height, hash }) =>
    set((state) => {
      const isNewBlock =
        state.latestBlockHeight !== height || state.latestBlockHash !== hash;

      return {
        latestBlockHeight: height,
        latestBlockHash: hash,
        error: null,
        refreshToken: isNewBlock ? state.refreshToken + 1 : state.refreshToken,
      };
    }),
  forceRefresh: () => set((state) => ({ refreshToken: state.refreshToken + 1 })),
  reset: () => set(initialMinaBlockState),
}));
