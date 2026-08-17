"use client";

import { useEffect } from "react";
import {
  createDefaultEndpointSettings,
  useEndpointSettingsStore,
} from "../store/endpoint-settings-store";

const STORAGE_KEY = "treasury-header-settings";
const LEGACY_LOCAL_API_URLS = new Set([
  "/api",
  "http://127.0.0.1:4100",
  "http://localhost:4100",
]);
const LEGACY_LOCAL_INDEXER_API_URLS = new Set([
  "/indexer",
  "http://127.0.0.1:4101",
  "http://localhost:4101",
]);
const LEGACY_LOCAL_PROCESSOR_API_URLS = new Set([
  "/processor",
  "http://127.0.0.1:4102",
  "http://localhost:4102",
]);
const LEGACY_LOCAL_MINA_NODE_URLS = new Set([
  "/mina/graphql",
  "http://127.0.0.1:3001/graphql",
  "http://localhost:3001/graphql",
  "http://127.0.0.1:8080/graphql",
  "http://localhost:8080/graphql",
]);

function migrateLocalProxySettings<
  TSettings extends {
    apiUrl: string;
    indexerApiUrl: string;
    processorApiUrl: string;
    minaNodeUrl: string;
  },
>(nextSettings: TSettings, defaults: TSettings): TSettings {
  return {
    ...nextSettings,
    apiUrl: LEGACY_LOCAL_API_URLS.has(nextSettings.apiUrl)
      ? defaults.apiUrl
      : nextSettings.apiUrl,
    indexerApiUrl: LEGACY_LOCAL_INDEXER_API_URLS.has(nextSettings.indexerApiUrl)
      ? defaults.indexerApiUrl
      : nextSettings.indexerApiUrl,
    processorApiUrl: LEGACY_LOCAL_PROCESSOR_API_URLS.has(
      nextSettings.processorApiUrl,
    )
      ? defaults.processorApiUrl
      : nextSettings.processorApiUrl,
    minaNodeUrl: LEGACY_LOCAL_MINA_NODE_URLS.has(nextSettings.minaNodeUrl)
      ? defaults.minaNodeUrl
      : nextSettings.minaNodeUrl,
  };
}

export function useEndpointSettings() {
  const hydrated = useEndpointSettingsStore((state) => state.hydrated);
  const settings = useEndpointSettingsStore((state) => state.value);
  const hydrateSettings = useEndpointSettingsStore(
    (state) => state.hydrateSettings,
  );
  const updateSettings = useEndpointSettingsStore(
    (state) => state.updateSettings,
  );

  useEffect(() => {
    if (hydrated || typeof window === "undefined") {
      return;
    }

    // Re-derived here rather than reused from the store so the deployment's
    // configuration is read after the runtime config script has certainly run,
    // instead of whenever the store module happened to evaluate. Every consumer
    // waits on `hydrated`, so this is the value they actually see.
    const defaults = createDefaultEndpointSettings();

    try {
      const storedValue = window.localStorage.getItem(STORAGE_KEY);
      if (!storedValue) {
        hydrateSettings(defaults);
        return;
      }

      hydrateSettings(
        migrateLocalProxySettings(
          {
            ...defaults,
            ...(JSON.parse(storedValue) as Partial<typeof defaults>),
          },
          defaults,
        ),
      );
    } catch {
      hydrateSettings(defaults);
    }
  }, [hydrateSettings, hydrated]);

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
