import { expect, test } from "@playwright/test";

test("opens the mobile navigation and reaches a lazy-loaded page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

  const menu = page.getByRole("button", { name: "Abrir menu" });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole("navigation")).toBeVisible();
  await page.getByRole("button", { name: "Contas futuras" }).click();

  await expect(page.getByRole("heading", { name: "Contas futuras", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir menu" })).toBeVisible();
});
