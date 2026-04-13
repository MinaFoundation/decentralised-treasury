"use client";

import { createElement } from "react";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { useAppShellErrorState } from "../store/app-shell-store.selectors";
import { useAppShellStore } from "../store/app-shell-store";

export function GlobalErrorNotification() {
  const appError = useAppShellErrorState();
  const clearAppError = useAppShellStore((state) => state.clearError);

  if (!appError.message) {
    return null;
  }

  return createElement(
    "div",
    {
      className:
        "fixed bottom-3 left-1/2 z-50 w-[min(28rem,calc(100vw-1.5rem))] -translate-x-1/2 sm:bottom-5",
      "data-component": "global-error-notification",
    },
    createElement(
      Alert,
      {
        variant: "destructive",
        className:
          "relative flex items-start gap-3 border-destructive/40 bg-background shadow-lg",
      },
      createElement(
        "span",
        {
          className:
            "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-xs font-semibold",
          "aria-hidden": "true",
        },
        "!",
      ),
      createElement(
        "div",
        {
          className: "min-w-0 flex-1",
        },
        createElement(AlertTitle, undefined, "Something went wrong"),
        createElement(AlertDescription, undefined, appError.message),
      ),
      createElement(
        Button,
        {
          type: "button",
          size: "sm",
          variant: "ghost",
          onClick: clearAppError,
          className:
            "absolute right-2 top-2 h-8 w-8 shrink-0 rounded-full p-0 text-muted-foreground hover:text-foreground",
          "aria-label": "Dismiss notification",
        },
        createElement(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "2",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            className: "h-4 w-4",
            "aria-hidden": "true",
          },
          createElement("path", {
            d: "M18 6 6 18",
          }),
          createElement("path", {
            d: "m6 6 12 12",
          }),
        ),
      ),
    ),
  );
}
