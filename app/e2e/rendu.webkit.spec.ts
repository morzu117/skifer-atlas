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
