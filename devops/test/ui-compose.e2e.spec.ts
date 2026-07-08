import { expect, test } from "@playwright/test";

const webUrl = process.env.WEB_URL ?? "http://127.0.0.1:3100";

test("compose web UI renders", async ({ page }) => {
  await page.goto(webUrl, { waitUntil: "networkidle" });

  await expect(page.locator("body")).toBeVisible();
  await expect(page).toHaveTitle(/treasury|mina/i);
});
