import { expect, test } from "@playwright/test";
import { ensureNordis } from "./demo";

// WebKit est le moteur de la vue Tauri sous macOS. Il ignore la hauteur d'un <select>
// natif : sans `appearance: none`, les filtres du catalogue tombaient à 22 px.

test.beforeAll(async ({ request }) => {
  await ensureNordis(request);
});

test("champs et filtres du catalogue à 44 px (guide 10.1)", async ({ page }) => {
  await page.goto("/#/w/groupe-nordis/catalogue");
  await expect(page.getByRole("link", { name: "Revenu net" })).toBeVisible();
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll(".search, .filters select")].map((el) => Math.round(el.getBoundingClientRect().height)),
  );
  expect(heights).toEqual([44, 44, 44, 44, 44]);
  await page.getByRole("combobox", { name: "Type" }).selectOption({ label: "KPI" });
  await expect(page).toHaveURL(/kind=kpi$/);
});

test("graphe en lecture et listes des versions de la fiche (guide 10.2)", async ({ page }) => {
  await page.goto("/#/w/groupe-nordis/fiche/revenu-net");
  const cards = page.getByRole("figure", { name: "Graphe de Revenu net" }).locator(".graph-card");
  await expect(cards).toHaveCount(7);
  const variation = cards.filter({ hasText: "n03" });
  await expect(variation).toHaveCSS("border-top-style", "dashed");
  const widths = await cards.evaluateAll((all) => all.map((el) => Math.round(el.getBoundingClientRect().width)));
  expect(new Set(widths)).toEqual(new Set([150]));

  await page.goto("/#/w/groupe-nordis/fiche/revenu-net?tab=versions");
  await expect(page.getByRole("combobox", { name: "De" })).toHaveValue("3");
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll(".compare-form select")].map((el) => Math.round(el.getBoundingClientRect().height)),
  );
  expect(heights).toEqual([44, 44]);
});
