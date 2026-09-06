"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TreasuryEndpointSettings } from "@repo/ui/treasury-settings-dialog";
import {
  getRuntimeConfig,
  type BackofficeRuntimeConfig,
} from "./runtime-config";

const SETTINGS_STORAGE_KEY = "treasury-header-settings";

interface BackofficeSettingsContextValue {
  settings: TreasuryEndpointSettings;
  defaultSettings: TreasuryEndpointSettings;
  config: BackofficeRuntimeConfig;
  saveSettings: (settings: TreasuryEndpointSettings) => void;
}

const BackofficeSettingsContext =
  createContext<BackofficeSettingsContextValue | null>(null);

function getDefaultSettings(
  config: BackofficeRuntimeConfig,
): TreasuryEndpointSettings {
  return {
    networkId: config.networkId,
    apiUrl: config.apiUrl,
    indexerApiUrl: config.indexerApiUrl,
    processorApiUrl: config.processorApiUrl,
    minaNodeUrl: config.minaNodeUrl,
  };
}

function readStoredSettings(
  defaults: TreasuryEndpointSettings,
): TreasuryEndpointSettings {
  if (typeof window === "undefined") return defaults;
  try {
    const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!stored) return defaults;
    return {
      ...defaults,
      ...(JSON.parse(stored) as Partial<TreasuryEndpointSettings>),
    };
  } catch {
    return defaults;
  }
}

export function BackofficeSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const runtimeConfig = useMemo(getRuntimeConfig, []);
  const defaultSettings = useMemo(
    () => getDefaultSettings(runtimeConfig),
    [runtimeConfig],
  );
  const [settings, setSettings] = useState(defaultSettings);

  useEffect(() => {
    setSettings(readStoredSettings(defaultSettings));
  }, [defaultSettings]);

  const value = useMemo<BackofficeSettingsContextValue>(
    () => ({
      settings,
      defaultSettings,
      config: {
        ...runtimeConfig,
        networkId: settings.networkId?.trim() || runtimeConfig.networkId,
        apiUrl: settings.apiUrl.trim(),
        indexerApiUrl: settings.indexerApiUrl.trim(),
        processorApiUrl: settings.processorApiUrl.trim(),
        minaNodeUrl:
          settings.minaNodeUrl.trim() || runtimeConfig.minaNodeUrl,
      },
      saveSettings: (nextSettings) => {
        setSettings(nextSettings);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            SETTINGS_STORAGE_KEY,
            JSON.stringify(nextSettings),
          );
        }
      },
    }),
    [defaultSettings, runtimeConfig, settings],
  );

  return (
    <BackofficeSettingsContext.Provider value={value}>
      {children}
    </BackofficeSettingsContext.Provider>
  );
}

export function useBackofficeSettings(): BackofficeSettingsContextValue {
  const value = useContext(BackofficeSettingsContext);
  if (!value) {
    throw new Error("BackofficeSettingsProvider is missing.");
  }
  return value;
}
