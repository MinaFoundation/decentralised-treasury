import { useEndpointSettingsStore } from "./endpoint-settings-store";

export const useEndpointSettingsState = () => useEndpointSettingsStore((state) => state);
