"use client";

function getBrowserOrigin(): string | undefined {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  if (typeof globalThis.location?.origin === "string") {
    return globalThis.location.origin;
  }

  return undefined;
}

function resolveBaseUrl(endpointRoot: string): URL {
  const trimmedEndpointRoot = endpointRoot.trim();
  const browserOrigin = getBrowserOrigin();

  if (!browserOrigin && !/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmedEndpointRoot)) {
    throw new Error(`Relative endpoint URL requires a browser origin: ${endpointRoot}`);
  }

  return new URL(trimmedEndpointRoot, browserOrigin);
}

export function resolveEndpointUrl(endpointRoot: string, path = ""): string {
  const baseUrl = resolveBaseUrl(endpointRoot);
  if (!path) {
    return baseUrl.toString();
  }

  const pathUrl = new URL(path, "http://endpoint.local");
  const rootPath = baseUrl.pathname.endsWith("/")
    ? baseUrl.pathname.slice(0, -1)
    : baseUrl.pathname;

  baseUrl.pathname = `${rootPath}${pathUrl.pathname}` || "/";
  baseUrl.search = pathUrl.search;
  baseUrl.hash = pathUrl.hash;

  return baseUrl.toString();
}
