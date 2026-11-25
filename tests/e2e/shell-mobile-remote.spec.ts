import { expect, test, type Page } from "@playwright/test";
import { mockSupabase } from "./support/supabaseMock";

// L1.1 - shell mobile com sessão autenticada mockada (Pixel 7, <= 720px).
async function logIn(page: Page) {
  await page.getByLabel("E-mail").fill("user@example.com");
  await page.getByLabel("Senha").fill("password123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
}

const visibleStatuses = (page: Page) => page.locator(".sidebar-sync").evaluateAll(
  (nodes) => nodes.filter((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1 && getComputedStyle(node).display !== "none";
  }).length,
);

test("authenticated mobile menu offers import, export and sign out; header shows Online Supabase once", async ({ page }) => {
  const supabase = await mockSupabase(page);
  await page.goto("/");
  await logIn(page);

  const status = page.getByTitle("Online Supabase");
  await expect(status).toBeVisible();
  expect((await status.boundingBox())!.y).toBeLessThan(52);
  expect(await visibleStatuses(page)).toBe(1);

  await expect(page.locator(".sidebar-logout")).toBeHidden(); // Sair só aparece no menu

  await page.getByRole("button", { name: "Abrir menu" }).click();
  await expect(page.getByRole("button", { name: "Exportar backup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Importar backup" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  expect(supabase.requests.some((request) => request.url.includes("/auth/v1/logout"))).toBe(true);
});

test("shows a compact sync error with retry in the mobile header", async ({ page }) => {
  await mockSupabase(page);
  let failWrites = true;
  await page.route("**/__supabase/rest/v1/**", async (route) => {
    if (failWrites && route.request().method() !== "GET" && route.request().method() !== "HEAD") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "falha simulada" }) });
      return;
    }
    await route.fallback();
  });
  await page.goto("/");
  await logIn(page);

  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByLabel("Saldo inicial").fill("2600");
  await page.getByLabel("Saldo inicial").press("Tab");

  const status = page.locator(".sidebar-sync").filter({ hasText: "Erro de sincronização" });
  await expect(status).toBeVisible({ timeout: 10_000 });
  expect((await status.boundingBox())!.y).toBeLessThan(52);
  expect(await visibleStatuses(page)).toBe(1);
  const retry = page.getByRole("button", { name: "Tentar sincronizar novamente" });
  await expect(retry).toBeVisible();
  const retryBox = (await retry.boundingBox())!;
  expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(412);

  failWrites = false;
  await retry.click();
  await expect(page.getByTitle("Online Supabase")).toBeVisible({ timeout: 8_000 });
  await expect(retry).toHaveCount(0);
});
