import { expect, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { isolatedDemo, test } from "./isolation";

// Écran 10.5 Comparaison sous WebKit, le moteur de la vue Tauri sous macOS : cases à cocher et
// curseur au clavier, listes natives, focus. Mêmes sources que ui-comparaison.spec.ts : maquette
// et guide 10.5, brief 10.5, plan 0015, ADR 0019. Chaque scénario part d'une copie isolée.

const launchButton = (page: Page) => page.getByRole("button", { name: /Lancer la comparaison|Relancer/ });
const cell = (page: Page, entity: string) => page.getByRole("link", { name: new RegExp(`^Revenu net × ${entity} :`) });
const detail = (page: Page) => page.getByRole("region", { name: /^Détail · / });

async function open(page: Page, root: string) {
  await page.goto(`${root}/comparaison`);
  await expect(page.getByRole("heading", { level: 1, name: "Comparaison" })).toBeVisible();
  await expect(page.getByText("Surcharge hors des points déclarés").first()).toBeVisible();
}

/** Lance au clavier (focus, Entrée) et attend la fin : rend le numéro de la comparaison. */
async function launchWithKeyboard(page: Page): Promise<number> {
  const started = page.waitForResponse((r) => /\/comparisons$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
  await launchButton(page).focus();
  await page.keyboard.press("Enter");
  const response = await started;
  expect(response.status()).toBe(202);
  const { id } = (await response.json()) as { id: number };
  await expect(page).toHaveURL(new RegExp(`id=${id}&variant=`), { timeout: 30_000 });
  return id;
}

test("[S-UI-105-22] WebKit : les déclinaisons se cochent et se décochent à la barre d'espace ; tout décocher refuse le lancement", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  const es = page.getByRole("checkbox", { name: /nordis-es/ });
  const de = page.getByRole("checkbox", { name: /nordis-de/ });
  const fr = page.getByRole("checkbox", { name: /nordis-fr/ });
  for (const box of [de, es, fr]) await expect(box).toBeChecked();

  await es.focus();
  await expect(es).toBeFocused();
  await page.keyboard.press("Space");
  await expect(es).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(es).toBeChecked();

  for (const box of [de, es, fr]) {
    await box.focus();
    await page.keyboard.press("Space");
    await expect(box).not.toBeChecked();
  }
  await expect(launchButton(page)).toHaveAttribute("aria-disabled", "true");
  await launchButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Cocher au moins une déclinaison.")).toBeVisible();
  await fr.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText("Cocher au moins une déclinaison.")).toHaveCount(0);
  await expect(launchButton(page)).not.toHaveAttribute("aria-disabled", "true");
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-UI-105-23] WebKit : le curseur de tolérance au clavier (flèches, Début, Fin) et à la souris", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  const slider = page.getByRole("slider", { name: /Tolérance/ });
  await expect(slider).toHaveValue("1.5");
  await slider.focus();
  await expect(slider).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveValue("1.6");
  await expect(page.getByText("Tolérance : 1,6 %")).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", "1,6 %");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(slider).toHaveValue("1.4");
  await page.keyboard.press("Home");
  await expect(slider).toHaveValue("0");
  await page.keyboard.press("End");
  await expect(slider).toHaveValue("5");
  await expect(page.getByText("Tolérance : 5 %")).toBeVisible();

  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  const dragged = Number(await slider.inputValue());
  expect(dragged).toBeGreaterThan(1);
  expect(dragged).toBeLessThan(3);
  await expect(page.getByText(`Tolérance : ${String(dragged).replace(".", ",")} %`)).toBeVisible();
});

test("[S-UI-105-24] WebKit : listes natives Granularité et Domaine, lancement à Entrée, cellule atteinte au clavier", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  const granularity = page.getByRole("combobox", { name: "Granularité" });
  await granularity.selectOption({ label: "Mois fiscal" });
  await expect(granularity.locator("option:checked")).toHaveText("Mois fiscal");
  await expect(page.getByLabel("Du", { exact: true })).toHaveValue("2026-02-01");
  await expect(page.getByLabel("Au", { exact: true })).toHaveValue("2026-09-30");

  await launchWithKeyboard(page);
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible();

  const domain = page.getByRole("combobox", { name: "Domaine" });
  await domain.selectOption({ label: "Supply chain" });
  await expect(page).toHaveURL(/domain=supply/);
  await expect(page.getByRole("rowheader", { name: "Revenu net" })).toHaveCount(0);
  await domain.selectOption({ label: "Tous domaines" });
  await expect(page.getByRole("rowheader", { name: "Revenu net" })).toBeVisible();

  // Depuis la liste Domaine, le clavier mène aux cellules de la matrice (guide 10.5 : cellule
  // sélectionnée entourée ; brief 10.5 : la cellule ouvre le détail). Sous WebKit, comme dans
  // Safari et la vue Tauri, Tab seul saute les liens : c'est Option+Tab qui les parcourt.
  await domain.focus();
  const es = cell(page, "nordis-es");
  for (let i = 0; i < 6 && !(await es.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("Alt+Tab");
  await expect(es).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/variant=nordis-es/);
  await expect(detail(page)).toHaveAccessibleName(/^Détail · Revenu net · nordis-es · par Mois fiscal$/);
  await expect(es).toHaveAttribute("aria-current", "true");
  expect(await seriousViolations(page)).toEqual([]);
});
