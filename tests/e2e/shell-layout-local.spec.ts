import { expect, test, type Page } from "@playwright/test";

// L1.1 - navegação e responsividade do shell (modo local, sem Supabase).
const DESTINATIONS = [
  "Dashboard", "Lançamentos", "Importar banco/cartão", "Cartões e parcelas",
  "Contas futuras", "Investimentos", "Metas e orçamento", "Configurações",
];
const MOBILE_BAR = ["Dashboard", "Lançamentos", "Contas futuras", "Metas e orçamento"];

const nav = (page: Page) => page.getByRole("navigation", { name: "Navegação principal" });
const visibleStatuses = (page: Page) => page.locator(".sidebar-sync").evaluateAll(
  (nodes) => nodes.filter((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden" && style.display !== "none";
  }).length,
);
const noHorizontalOverflow = (page: Page) => page.evaluate(() => {
  const viewportWidth = window.innerWidth;
  const pageWidth = document.documentElement.scrollWidth;
  const unexpectedOverflow = Array.from(document.body.querySelectorAll<HTMLElement>("*"))
    .some((element) => {
      const intentionalScroll = element.closest<HTMLElement>(".table-wrap");
      if (intentionalScroll && ["auto", "scroll"].includes(getComputedStyle(intentionalScroll).overflowX)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > viewportWidth + 1);
    });
  return pageWidth <= viewportWidth && !unexpectedOverflow;
});

test.describe("desktop (>= 1024px)", () => {
  for (const [width, height] of [[1440, 900], [1024, 768]]) {
    test(`shows the full 240px sidebar with icons, names and active state at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const sidebar = page.locator("aside.sidebar");
      const box = (await sidebar.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(236);
      expect(box.width).toBeLessThanOrEqual(244);

      for (const name of DESTINATIONS) {
        const button = nav(page).getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        await expect(button.locator("svg")).toBeVisible();
        const label = button.locator(".nav-label");
        await expect(label).toHaveText(name);
        const labelBox = (await label.boundingBox())!;
        const buttonBox = (await button.boundingBox())!;
        expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width + 1);
      }
      await expect(nav(page).getByRole("button", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(nav(page).getByRole("button", { name: "Lançamentos", exact: true })).not.toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("button", { name: "Abrir menu" })).toBeHidden();
      expect(await visibleStatuses(page)).toBe(1);
      expect(await noHorizontalOverflow(page)).toBe(true);
    });
  }
});

test.describe("tablet (721-1023px): icon rail", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
  });

  test("keeps all 8 destinations visible, uncut and accessibly named", async ({ page }) => {
    const sidebarBox = (await page.locator("aside.sidebar").boundingBox())!;
    expect(sidebarBox.width).toBeGreaterThanOrEqual(64);
    expect(sidebarBox.width).toBeLessThanOrEqual(80);

    const buttons = nav(page).getByRole("button");
    await expect(buttons).toHaveCount(8);
    for (const name of DESTINATIONS) {
      const button = nav(page).getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("title", name);
      await expect(button).toHaveAttribute("aria-label", name);
      await expect(button.locator("svg")).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
      expect(box.y + box.height).toBeLessThanOrEqual(1024);
      expect(box.width).toBeGreaterThanOrEqual(40);
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
    await expect(nav(page).getByRole("button", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("gives the main area room and does not overflow the page", async ({ page }) => {
    const main = (await page.locator("main.main").boundingBox())!;
    expect(main.width).toBeGreaterThanOrEqual(640);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test("navigates the rail by keyboard with a visible focus ring", async ({ page }) => {
    await nav(page).getByRole("button", { name: "Dashboard", exact: true }).focus();
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveAccessibleName("Lançamentos");
    expect(await focused.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
    await expect(focused).not.toHaveCSS("outline-style", "none");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Lançamentos", level: 1 })).toBeVisible();
  });

  test("keeps backup actions and one sync indicator reachable in the rail", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Exportar backup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Importar backup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Exportar backup" })).toHaveAttribute("title", "Exportar backup");
    await expect(page.getByTitle("Salvo localmente")).toBeVisible();
    expect(await visibleStatuses(page)).toBe(1);
  });

  test("shows the Cartões e parcelas summary cards in 2 columns", async ({ page }) => {
    await nav(page).getByRole("button", { name: "Cartões e parcelas", exact: true }).click();
    const cards = page.locator(".installment-overview > *");
    await expect(cards).toHaveCount(4);
    const boxes = await cards.evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top) };
    }));
    const columns = new Set(boxes.map((box) => box.left));
    const rows = new Set(boxes.map((box) => box.top));
    expect(columns.size).toBe(2);
    expect(rows.size).toBe(2);
    expect(new Set(boxes.map((box) => `${box.left}:${box.top}`)).size).toBe(4);
    for (const left of columns) expect(boxes.filter((box) => box.left === left)).toHaveLength(2);
    for (const top of rows) expect(boxes.filter((box) => box.top === top)).toHaveLength(2);
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});

test.describe("mobile (<= 720px)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
  });

  test("shows a bottom bar with the 4 primary destinations and a short Metas label", async ({ page }) => {
    const visible = [];
    for (const name of DESTINATIONS) {
      const button = nav(page).getByRole("button", { name, exact: true });
      if (await button.isVisible()) visible.push(name);
    }
    expect(visible).toEqual(MOBILE_BAR);

    const sidebarBox = (await page.locator("aside.sidebar").boundingBox())!;
    expect(Math.round(sidebarBox.y + sidebarBox.height)).toBe(844);
    expect(sidebarBox.height).toBeGreaterThanOrEqual(64);

    const metas = nav(page).getByRole("button", { name: "Metas e orçamento", exact: true });
    expect(await metas.evaluate((node) => getComputedStyle(node, "::after").content)).toBe('"Metas"');
    await expect(metas).toHaveAccessibleName("Metas e orçamento");
    const box = (await metas.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expect(nav(page).getByRole("button", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("sizes the bottom bar and page padding for the computed safe-area inset", async ({ page }) => {
    const safeArea = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>("aside.sidebar")!;
      const main = document.querySelector<HTMLElement>("main.main")!;
      const insetProbe = document.createElement("div");
      insetProbe.style.paddingBottom = "env(safe-area-inset-bottom, 0px)";
      document.body.append(insetProbe);
      const safeAreaInset = Number.parseFloat(getComputedStyle(insetProbe).paddingBottom);
      insetProbe.remove();
      const bottomNavHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bottom-nav-h"));
      const sidebarBox = sidebar.getBoundingClientRect();
      const sidebarStyle = getComputedStyle(sidebar);
      const mainStyle = getComputedStyle(main);
      return {
        barTop: sidebarBox.top,
        barBottom: sidebarBox.bottom,
        viewportHeight: window.innerHeight,
        barHeight: Number.parseFloat(sidebarStyle.height),
        barPaddingBottom: Number.parseFloat(sidebarStyle.paddingBottom),
        mainPaddingBottom: Number.parseFloat(mainStyle.paddingBottom),
        safeAreaInset,
        bottomNavHeight,
      };
    });
    expect(safeArea.barHeight).toBeCloseTo(safeArea.bottomNavHeight + safeArea.safeAreaInset, 0);
    expect(safeArea.barPaddingBottom).toBeCloseTo(safeArea.safeAreaInset, 0);
    expect(safeArea.mainPaddingBottom).toBeGreaterThanOrEqual(safeArea.bottomNavHeight + safeArea.safeAreaInset + 24);
    expect(safeArea.barTop).toBeGreaterThanOrEqual(0);
    expect(safeArea.barBottom).toBeLessThanOrEqual(safeArea.viewportHeight);
  });

  test("does not let the bottom bar cover the end of the page", async ({ page }) => {
    await expect(page.getByRole("region", { name: "Resumo do mês" })).toBeVisible();
    const barTop = (await page.locator("aside.sidebar").boundingBox())!.y;
    await expect.poll(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      return page.locator("main.main").evaluate((main) => (main.lastElementChild as HTMLElement).getBoundingClientRect().bottom);
    }).toBeLessThanOrEqual(barTop);
  });

  test("keeps a visible focus ring on the bar", async ({ page }) => {
    await nav(page).getByRole("button", { name: "Dashboard", exact: true }).focus();
    await page.keyboard.press("Tab");
    const focused = page.locator(":focus");
    await expect(focused).toHaveAccessibleName("Lançamentos");
    expect(await focused.evaluate((node) => node.matches(":focus-visible"))).toBe(true);
    await expect(focused).not.toHaveCSS("outline-style", "none");
  });

  test("opens a menu with every destination, import and export", async ({ page }) => {
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(page.getByRole("button", { name: "Fechar menu" })).toHaveAttribute("aria-expanded", "true");
    for (const name of DESTINATIONS) {
      await expect(nav(page).getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Exportar backup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Importar backup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sair" })).toHaveCount(0); // sem sessão (modo local)

    await nav(page).getByRole("button", { name: "Investimentos", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Investimentos", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir menu" })).toHaveAttribute("aria-expanded", "false");
  });

  test("shows exactly one compact sync status in the header", async ({ page }) => {
    const status = page.getByTitle("Salvo localmente");
    await expect(status).toBeVisible();
    await expect(status).toContainText("Salvo localmente");
    expect(await visibleStatuses(page)).toBe(1);
    const box = (await status.boundingBox())!;
    expect(box.y).toBeLessThan(52);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expect(page.locator("header.topbar")).not.toContainText("Modo local");
    // com o menu aberto continua existindo um único indicador visível
    await page.getByRole("button", { name: "Abrir menu" }).click();
    expect(await visibleStatuses(page)).toBe(1);
  });

  test("has no horizontal overflow", async ({ page }) => {
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});
