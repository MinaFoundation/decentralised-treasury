import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { GlobalErrorNotification } from "./global-error-notification";
import { useAppShellStore } from "../store/app-shell-store";

describe("GlobalErrorNotification", () => {
  beforeEach(() => {
    useAppShellStore.getState().reset();
  });

  it("renders the current app error and dismisses it", () => {
    useAppShellStore.getState().setError("Failed to fetch treasury balance.");

    render(createElement(GlobalErrorNotification));

    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("Failed to fetch treasury balance.")).toBeTruthy();
    expect(document.querySelector('[data-component="global-error-notification"]')).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(useAppShellStore.getState().error.message).toBeNull();
  });
});
