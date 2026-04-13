import { create } from "zustand";

export interface AppShellErrorState {
  message: string | null;
}

interface AppShellStore {
  error: AppShellErrorState;
  setError: (message: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

export const initialAppShellStoreState: AppShellErrorState = {
  message: null,
};

export const useAppShellStore = create<AppShellStore>((set) => ({
  error: initialAppShellStoreState,
  setError: (message) =>
    set(() => ({
      error: {
        message,
      },
    })),
  clearError: () =>
    set(() => ({
      error: {
        message: null,
      },
    })),
  reset: () =>
    set(() => ({
      error: initialAppShellStoreState,
    })),
}));
