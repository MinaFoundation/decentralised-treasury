import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TreasuryHeader } from "./treasury-header";

it.each([
  { server: "MacIntel", client: "Win32", shortcut: "Ctrl+K" },
  { server: "Win32", client: "MacIntel", shortcut: "⌘K" },
])("hydrates the shortcut from $server to $client without errors", async ({ server, client, shortcut }) => {
  const platform = vi.spyOn(navigator, "platform", "get").mockReturnValue(server);
  const container = document.createElement("div");
  container.innerHTML = renderToString(<TreasuryHeader />);
  document.body.append(container);
  platform.mockReturnValue(client);
  const errors: unknown[] = [];
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <TreasuryHeader />, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    expect(errors).toEqual([]);
    expect(container.querySelector('[data-component="header-proposal-search-trigger"]')?.getAttribute("aria-label")).toBe(`Find proposals (${shortcut})`);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    platform.mockRestore();
  }
});
