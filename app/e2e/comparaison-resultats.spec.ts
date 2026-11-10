import { expect, type Page } from "@playwright/test";
import { API, seriousViolations } from "./demo";
import { isolatedDemo, test } from "./isolation";

// Plan 0015 : ce que la comparaison locale (DuckDB, serveur principal) donne à voir quand on
// sort des réglages par défaut, sur une copie isolée de la démonstration dont l'historique est
// vide : états avant toute comparaison, tolérance et période réellement exécutées, couleurs
// de la matrice, historique.

const launchButton = (page: Page) => page.getByRole("button", { name: /Lancer la comparaison|Relancer/ });
const matrix = (page: Page) => page.getByRole("table").filter({ hasText: "KPI \\ Déclinaison" });
const cell = (page: Page, entity: string) => page.getByRole("link", { name: new RegExp(`Revenu net × ${entity} :`) });

async function open(page: Page, root: string) {
  await page.goto(`${root}/comparaison`);
  await expect(page.getByText("Surcharge hors des points déclarés")).toBeVisible();
}

test("[S-0015-07] avant toute comparaison : « non comparé » dans la matrice, historique vide, domaine sans KPI décliné", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  const row = matrix(page).getByRole("row").filter({ hasText: "Revenu net" });
  await expect(row.locator(".matrix-never")).toHaveCount(3); // nordis-de, nordis-es, nordis-fr
  await expect(row.getByText("non comparé")).toHaveCount(3);
  await expect(page.getByText("Exécutée avec vos droits · résultats agrégés uniquement · historique local (DuckDB, espace Groupe Nordis)")).toBeVisible();
  const strip = page.getByRole("region", { name: "Dernières comparaisons" });
  await expect(strip.getByText("Aucune comparaison dans cet espace.")).toBeVisible();
  await strip.getByRole("link", { name: "Tout voir" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Historique des comparaisons" })).toBeVisible();
  await expect(page.getByText("Aucune comparaison dans cet espace.")).toBeVisible();
  expect(await seriousViolations(page)).toEqual([]);

  // Un domaine où aucun KPI n'est décliné ne laisse pas de matrice vide.
  await page.goto(`${ws.root}/comparaison`);
  const domains = page.getByRole("combobox", { name: "Domaine" });
  const options = await domains.locator("option").allTextContents();
  const empty = options.find((label) => !["Tous domaines", "Finance"].includes(label.trim()));
  expect(empty, "un domaine sans KPI décliné existe dans la démonstration").toBeTruthy();
  await domains.selectOption({ label: empty! });
  await expect(page.getByText("Aucun KPI décliné dans ce domaine.")).toBeVisible();
});

test("[S-0015-11] la tolérance choisie est appliquée au calcul : à 5 %, nordis-es passe de 75 % à 100 %, nordis-de reste à 94 %", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  await page.getByRole("slider", { name: /Tolérance/ }).fill("5");
  await expect(page.getByText("Tolérance : 5 %")).toBeVisible();
  await launchButton(page).click();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 20_000 });

  await expect(cell(page, "nordis-es")).toContainText("100 %");
  await expect(cell(page, "nordis-de")).toContainText("94 %");
  await expect(cell(page, "nordis-fr")).toContainText("100 %");
  // La tolérance 1 % du KPI ne s'applique plus : les huit cellules de nordis-es sont dans la tolérance.
  await cell(page, "nordis-es").click();
  const detail = page.getByRole("region", { name: /Détail · Revenu net · nordis-es/ });
  await expect(detail.locator("tr.is-out")).toHaveCount(0);
  expect(await seriousViolations(page)).toEqual([]);
});

test("[S-0015-01] une période raccourcie retire les mois exclus du détail ; la matrice colore les seuils", async ({ page, request }) => {
  const ws = await isolatedDemo(request, API);
  await open(page, ws.root);
  await launchButton(page).click();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 20_000 });
  // Seuils : 100 % passe, 94 % avertit, 75 % échoue.
  await expect(cell(page, "nordis-fr").locator("xpath=ancestor::td")).toHaveClass(/tone-cell-pass/);
  await expect(cell(page, "nordis-de").locator("xpath=ancestor::td")).toHaveClass(/tone-cell-warn/);
  await expect(cell(page, "nordis-es").locator("xpath=ancestor::td")).toHaveClass(/tone-cell-bad/);
  await cell(page, "nordis-de").click();
  const detail = page.getByRole("region", { name: /Détail · Revenu net · nordis-de/ });
  await expect(detail.getByRole("row", { name: /Sept\. 2026 DE/ })).toHaveCount(1);

  // Sans septembre, la seule cellule hors tolérance de nordis-de disparaît du calcul.
  await page.getByLabel("Du").fill("2026-02-01");
  await page.getByLabel("Au").fill("2026-08-31");
  await launchButton(page).click();
  await expect(page.getByRole("button", { name: "Relancer" })).toBeVisible({ timeout: 20_000 });
  await expect(cell(page, "nordis-de")).toContainText("100 %");
  await cell(page, "nordis-de").click();
  await expect(page.getByRole("region", { name: /Détail · Revenu net · nordis-de/ }).getByRole("row", { name: /Sept\. 2026 DE/ })).toHaveCount(0);

  // L'historique de cette copie ne contient que ces deux lancements, et seulement eux.
  await page.goto(`${ws.root}/comparaison?vue=historique`);
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows).toHaveCount(3); // en-tête + deux comparaisons
  await expect(rows.nth(1)).toContainText("nordis-de 100 %");
  await expect(rows.nth(2)).toContainText("nordis-de 94 %");
  expect(await seriousViolations(page)).toEqual([]);
});
