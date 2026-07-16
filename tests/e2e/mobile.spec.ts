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

test("renders the financial summary without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  const summary = page.getByRole("region", { name: "Disponível no mês" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("Receitas")).toBeVisible();
  await expect(summary.getByText("Gastos")).toBeVisible();
  await expect(summary.getByText("Compromissos futuros")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("renders transactions as mobile cards without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("button", { name: "Lançamentos" }).click();
  await expect(page.getByRole("heading", { name: "Lançamentos", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Filtros de lançamentos")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
