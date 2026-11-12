import { expect, test } from "@playwright/test";
import { mockSupabase } from "./support/supabaseMock";

test("loads remote transactions with mocked Supabase on Pixel 7", async ({ page }) => {
  const supabase = await mockSupabase(page);
  await page.goto("/");

  await page.getByLabel("E-mail").fill("user@example.com");
  await page.getByLabel("Senha").fill("password123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.getByRole("button", { name: "Lançamentos" }).click();
  await expect(page.getByRole("heading", { name: "Lançamentos", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Excluir lançamento Transação remota E2E" })).toBeVisible();

  expect(supabase.requests.some((request) => request.url.includes("/auth/v1/token"))).toBe(true);
  expect(supabase.requests.some((request) => request.method === "GET" && request.url.includes("/rest/v1/transactions"))).toBe(true);
});
