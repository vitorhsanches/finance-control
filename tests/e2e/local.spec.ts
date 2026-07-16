import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
});

test("starts and navigates across eager and lazy pages with a visible fallback", async ({ page }) => {
  await page.route("**/src/pages/BillsPage.tsx*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  for (const pageName of ["Lançamentos", "Metas e orçamento", "Configurações", "Importar banco/cartão", "Cartões e parcelas"]) {
    await page.getByRole("button", { name: pageName }).click();
    await expect(page.getByRole("heading", { name: pageName, level: 1 })).toBeVisible();
  }

  await page.getByRole("button", { name: "Contas futuras" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Carregando página" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contas futuras", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Investimentos" }).click();
  await expect(page.getByRole("heading", { name: "Investimentos", level: 1 })).toBeVisible();
});

test("adds, edits, filters and confirms deletion of a transaction", async ({ page }) => {
  await page.getByRole("button", { name: "Lançamentos" }).click();
  await page.getByRole("button", { name: "Adicionar" }).click();
  const newTransaction = page.getByRole("row", { name: /Novo lançamento/ });
  await expect(newTransaction).toBeVisible();

  const typeFilter = page.locator(".transaction-filters").getByLabel("Tipo");
  await typeFilter.selectOption("income");
  await expect(newTransaction).toBeHidden();
  await typeFilter.selectOption("Todos");
  await expect(newTransaction).toBeVisible();

  await page.getByLabel("Descrição de Novo lançamento").fill("Café E2E");
  await page.getByRole("button", { name: "Salvar Novo lançamento" }).click();
  await expect(page.getByText("Café E2E")).toBeVisible();
  await expect(page.getByText("Alterações salvas com sucesso.")).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Excluir lançamento Café E2E" }).click();
  await expect(page.getByText("Café E2E")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Excluir lançamento Café E2E" }).click();
  await expect(page.getByText("Café E2E")).toHaveCount(0);
});

test("imports a generic CSV through mapping and preview", async ({ page }) => {
  await page.getByRole("button", { name: "Importar banco/cartão" }).click();
  await page.getByLabel(/Selecionar arquivos/).setInputFiles({
    name: "generic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Quando;Texto;Quantia\n10/07/2026;Padaria;-25,50"),
  });

  await expect(page.getByRole("heading", { name: /2\. Mapear generic\.csv/ })).toBeVisible();
  await page.getByLabel(/Coluna de data/).selectOption("Quando");
  await page.getByLabel(/Coluna de descrição/).selectOption("Texto");
  await page.getByLabel(/Coluna de valor/).selectOption("Quantia");
  await page.getByRole("button", { name: "Revisar importação" }).click();
  await expect(page.getByRole("heading", { name: "3. Revise antes de importar" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Padaria/ })).toBeVisible();
});

test("exports and restores a backup using the browser file flows", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar backup" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();

  await page.getByRole("button", { name: "Lançamentos" }).click();
  await page.getByRole("button", { name: "Adicionar" }).click();
  const newTransaction = page.getByRole("row", { name: /Novo lançamento/ });
  await expect(newTransaction).toBeVisible();

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Importar backup" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(backupPath!);

  await expect(newTransaction).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Backup importado" })).toBeVisible();
});
