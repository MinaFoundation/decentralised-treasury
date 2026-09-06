import { expect, test } from "@playwright/test";

test("renders the action tabs and fails closed without deployment config", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/treasury back office/i);
  await expect(
    page.getByRole("heading", { name: "Break-glass operations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByLabel("Mina node URL")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Back office is not ready")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Pause treasury" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("tab", { name: "Toggle proposal pause" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("tab", { name: "Rotate multisig keys" }),
  ).toBeDisabled();
});
