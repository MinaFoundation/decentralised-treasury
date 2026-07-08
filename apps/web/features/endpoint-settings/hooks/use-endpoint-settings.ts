"use client";

import { useEffect } from "react";
import { useEndpointSettingsStore } from "../store/endpoint-settings-store";

const STORAGE_KEY = "treasury-header-settings";
const LEGACY_LOCAL_API_URLS = new Set([
  "http://127.0.0.1:4100",
  "http://localhost:4100",
]);
const LEGACY_LOCAL_MINA_NODE_URLS = new Set([
  "http://127.0.0.1:3001/graphql",
  "http://localhost:3001/graphql",
  "http://127.0.0.1:8080/graphql",
  "http://localhost:8080/graphql",
]);

function migrateLocalProxySettings<TSettings extends { apiUrl: string; minaNodeUrl: string }>(
  nextSettings: TSettings,
  defaults: TSettings,
): TSettings {
  return {
    ...nextSettings,
    apiUrl:
      defaults.apiUrl.startsWith("/") && LEGACY_LOCAL_API_URLS.has(nextSettings.apiUrl)
        ? defaults.apiUrl
        : nextSettings.apiUrl,
    minaNodeUrl:
      defaults.minaNodeUrl.startsWith("/") &&
      LEGACY_LOCAL_MINA_NODE_URLS.has(nextSettings.minaNodeUrl)
        ? defaults.minaNodeUrl
        : nextSettings.minaNodeUrl,
  };
}

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

      hydrateSettings(
        migrateLocalProxySettings(
          {
            ...settings,
            ...(JSON.parse(storedValue) as Partial<typeof settings>),
          },
          settings,
        ),
      );
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
