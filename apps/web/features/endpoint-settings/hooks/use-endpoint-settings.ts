"use client";

import { useEffect } from "react";
import { useEndpointSettingsStore } from "../store/endpoint-settings-store";

const STORAGE_KEY = "treasury-header-settings";

export function useEndpointSettings() {
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const settings = useEndpointSettingsStore((state) => state.value);
  const hydrateSettings = useEndpointSettingsStore((state) => state.hydrateSettings);
  const updateSettings = useEndpointSettingsStore((state) => state.updateSettings);

  useEffect(() => {
    if (hydrated || typeof window === "undefined") {
      return;
    }

    try {
      const storedValue = window.localStorage.getItem(STORAGE_KEY);
      if (!storedValue) {
        hydrateSettings(settings);
        return;
      }

      hydrateSettings({
        ...settings,
        ...(JSON.parse(storedValue) as Partial<typeof settings>),
      });
    } catch {
      hydrateSettings(settings);
    }
  }, [hydrateSettings, hydrated, settings]);

  const saveSettings = (nextSettings: typeof settings) => {
    updateSettings(nextSettings);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
    }
  };

  return {
    hydrated,
    settings,
    saveSettings,
  };
}
