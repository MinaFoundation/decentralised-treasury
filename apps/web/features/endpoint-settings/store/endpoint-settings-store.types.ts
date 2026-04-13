import type { TreasuryEndpointSettings } from "@repo/ui/treasury-settings-dialog";

export interface EndpointSettingsState {
  value: TreasuryEndpointSettings;
  hydrated: boolean;
}

export interface EndpointSettingsStoreActions {
  hydrateSettings: (value: TreasuryEndpointSettings) => void;
  updateSettings: (value: TreasuryEndpointSettings) => void;
  reset: () => void;
}

export type EndpointSettingsStore = EndpointSettingsState & EndpointSettingsStoreActions;
