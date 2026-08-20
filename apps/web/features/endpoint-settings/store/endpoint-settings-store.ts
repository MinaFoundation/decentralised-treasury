import { create } from "zustand";
import { getRuntimeConfig } from "../../runtime-config/lib/get-runtime-config";
import type {
  EndpointSettingsState,
  EndpointSettingsStore,
} from "./endpoint-settings-store.types";

/**
 * The endpoints this deployment was configured with, before any per-browser
 * override stored by `useEndpointSettings` is layered on top.
 */
export function createDefaultEndpointSettings(): EndpointSettingsState["value"] {
  const config = getRuntimeConfig();

  return {
    networkId: config.networkId,
    apiUrl: config.apiUrl,
    indexerApiUrl: config.indexerApiUrl,
    processorApiUrl: config.processorApiUrl,
    minaNodeUrl: config.minaNodeUrl,
  };
}

export const defaultEndpointSettings: EndpointSettingsState["value"] =
  createDefaultEndpointSettings();

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
