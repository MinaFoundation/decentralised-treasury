import { create } from "zustand";
import type {
  EndpointSettingsState,
  EndpointSettingsStore,
} from "./endpoint-settings-store.types";

export const defaultEndpointSettings: EndpointSettingsState["value"] = {
  networkId: process.env.NEXT_PUBLIC_NETWORK_ID ?? "MAINNET",
  apiUrl:
    process.env.NEXT_PUBLIC_TREASURY_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://127.0.0.1:3100/api",
  indexerApiUrl:
    process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "http://127.0.0.1:3100/indexer",
  processorApiUrl:
    process.env.NEXT_PUBLIC_PROCESSOR_API_URL ??
    "http://127.0.0.1:3100/processor",
  minaNodeUrl:
    process.env.NEXT_PUBLIC_MINA_NODE_URL ??
    "http://127.0.0.1:3100/mina/graphql",
};

export const initialEndpointSettingsState: EndpointSettingsState = {
  value: defaultEndpointSettings,
  hydrated: false,
};

export const useEndpointSettingsStore = create<EndpointSettingsStore>(
  (set) => ({
    ...initialEndpointSettingsState,
    hydrateSettings: (value) =>
      set(() => ({
        value,
        hydrated: true,
      })),
    updateSettings: (value) =>
      set((state) => ({
        ...state,
        value,
      })),
    reset: () => set(initialEndpointSettingsState),
  }),
);
