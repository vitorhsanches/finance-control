import { expect, test } from "@playwright/test";
import { mockSupabase } from "./support/supabaseMock";

async function logIn(page: import("@playwright/test").Page) {
  await page.getByLabel("E-mail").fill("user@example.com");
  await page.getByLabel("Senha").fill("password123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
}

test("shows authentication failure and then completes a successful login", async ({ page }) => {
  await mockSupabase(page);
  await page.goto("/");

  await page.getByLabel("E-mail").fill("failure@example.com");
  await page.getByLabel("Senha").fill("password123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(/E-mail ou senha inválidos/)).toBeVisible();

  await page.getByLabel("E-mail").fill("user@example.com");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByText("Olá, Pessoa E2E")).toBeVisible();
});

test("shows autosave feedback and logs out after remote persistence", async ({ page }) => {
  const supabase = await mockSupabase(page, { writeDelay: 500 });
  await page.goto("/");
  await logIn(page);

  await page.getByRole("button", { name: "Configurações" }).click();
  await page.getByLabel("Saldo inicial").fill("2500");
  await page.getByLabel("Saldo inicial").press("Tab");
  await expect(page.getByText("Salvando online...")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByText("Online Supabase")).toBeVisible({ timeout: 8_000 });

  const logoutButtons = page.getByRole("button", { name: "Sair" });
  await logoutButtons.last().click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  expect(supabase.requests.some((request) => request.url.includes("/auth/v1/logout"))).toBe(true);
  expect(supabase.requests.some((request) => request.method !== "GET" && request.url.includes("/rest/v1/"))).toBe(true);
});

test("persists a transaction deletion across reload with both ownership filters", async ({ page }) => {
  const supabase = await mockSupabase(page);
  await page.goto("/");
  await logIn(page);

  await page.getByRole("button", { name: "Lançamentos" }).click();
  const deleteButton = page.getByRole("button", { name: "Excluir lançamento Transação remota E2E" });
  await expect(deleteButton).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await deleteButton.click();
  await expect(deleteButton).toHaveCount(0);

  const deleteRequest = supabase.requests.find((request) => request.method === "DELETE" && request.url.includes("/rest/v1/transactions"));
  expect(deleteRequest?.url).toContain("user_id=eq.e2e-user");
  expect(deleteRequest?.url).toContain("id=eq.remote-t1");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Lançamentos" }).click();
  await expect(page.getByRole("button", { name: "Excluir lançamento Transação remota E2E" })).toHaveCount(0);
});
