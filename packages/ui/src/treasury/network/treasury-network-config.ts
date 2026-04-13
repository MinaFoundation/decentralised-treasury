export type TreasuryNetworkId = "MAINNET" | "DEVNET" | "LIGHTNET" | (string & {});

export interface TreasuryNetworkOption {
  id: TreasuryNetworkId;
  label: string;
  apiUrl?: string;
  minaNodeUrl?: string;
}

export interface ResolveTreasuryNetworkOptionsInput {
  networkOptions?: TreasuryNetworkOption[];
  networkConfigRaw?: string | null;
}

export const TREASURY_NETWORKS_ENV_VAR = "TREASURY_NETWORKS";
export const NEXT_PUBLIC_TREASURY_NETWORKS_ENV_VAR = "NEXT_PUBLIC_TREASURY_NETWORKS";

export const DEFAULT_TREASURY_NETWORKS: readonly TreasuryNetworkOption[] = [
  { id: "MAINNET", label: "Mainnet" },
  { id: "DEVNET", label: "Devnet" },
  { id: "LIGHTNET", label: "Lightnet", minaNodeUrl: "http://localhost:8080/graphql" },
] as const;

function normalizeNetworkId(value: string): TreasuryNetworkId {
  return value.trim().replace(/[\s-]+/g, "_").toUpperCase() as TreasuryNetworkId;
}

function normalizeNetworkLabel(id: string): string {
  return id
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function sanitizeNetworkOption(input: unknown): TreasuryNetworkOption | null {
  if (typeof input === "string") {
    const id = normalizeNetworkId(input);
    if (!id) {
      return null;
    }
    return { id, label: normalizeNetworkLabel(id) };
  }

  if (typeof input !== "object" || input === null) {
    return null;
  }

  const candidate = input as {
    id?: unknown;
    label?: unknown;
    apiUrl?: unknown;
    minaNodeUrl?: unknown;
  };
  if (typeof candidate.id !== "string" || !candidate.id.trim()) {
    return null;
  }

  const id = normalizeNetworkId(candidate.id);
  const label =
    typeof candidate.label === "string" && candidate.label.trim()
      ? candidate.label.trim()
      : normalizeNetworkLabel(id);

  const apiUrl =
    typeof candidate.apiUrl === "string" && candidate.apiUrl.trim()
      ? candidate.apiUrl.trim()
      : undefined;
  const minaNodeUrl =
    typeof candidate.minaNodeUrl === "string" && candidate.minaNodeUrl.trim()
      ? candidate.minaNodeUrl.trim()
      : undefined;

  return { id, label, apiUrl, minaNodeUrl };
}

function mergeWithDefaults(networks: TreasuryNetworkOption[]): TreasuryNetworkOption[] {
  const merged = new Map<string, TreasuryNetworkOption>();

  for (const network of DEFAULT_TREASURY_NETWORKS) {
    merged.set(network.id, { ...network });
  }

  for (const network of networks) {
    merged.set(network.id, network);
  }

  return Array.from(merged.values());
}

function parseNetworkList(raw: string): TreasuryNetworkOption[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" &&
          parsed !== null &&
          "networks" in parsed &&
          Array.isArray((parsed as { networks?: unknown }).networks)
        ? ((parsed as { networks: unknown[] }).networks ?? [])
        : [];
    return list
      .map((item) => sanitizeNetworkOption(item))
      .filter((item): item is TreasuryNetworkOption => item !== null);
  } catch {
    return trimmed
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => sanitizeNetworkOption(token))
      .filter((item): item is TreasuryNetworkOption => item !== null);
  }
}

export function resolveTreasuryNetworkOptions(
  input: ResolveTreasuryNetworkOptionsInput = {},
): TreasuryNetworkOption[] {
  const fromProps = input.networkOptions ?? [];
  const fromEnv = parseNetworkList(input.networkConfigRaw ?? "");
  const mergedInput = [...fromProps, ...fromEnv]
    .map((item) => sanitizeNetworkOption(item))
    .filter((item): item is TreasuryNetworkOption => item !== null);

  return mergeWithDefaults(mergedInput);
}

export function resolveTreasuryNetworkOptionsFromEnv(
  networkConfigRaw: string | null | undefined,
): TreasuryNetworkOption[] {
  return resolveTreasuryNetworkOptions({ networkConfigRaw });
}

export function resolveTreasuryNetworkById(
  networkId: string | null | undefined,
  networks: TreasuryNetworkOption[] = resolveTreasuryNetworkOptions(),
): TreasuryNetworkOption | undefined {
  if (!networkId) {
    return undefined;
  }

  const normalized = normalizeNetworkId(networkId);
  return networks.find((network) => network.id === normalized);
}

export function resolveTreasuryNetworkLabel(
  networkId: string | null | undefined,
  networks: TreasuryNetworkOption[] = resolveTreasuryNetworkOptions(),
): string | undefined {
  if (!networkId) {
    return undefined;
  }

  const resolved = resolveTreasuryNetworkById(networkId, networks);
  if (resolved) {
    return resolved.label;
  }

  return normalizeNetworkLabel(normalizeNetworkId(networkId));
}
